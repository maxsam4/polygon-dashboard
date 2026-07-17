import {
  BINANCE_API_URLS,
  BINANCE_KLINE_LIMIT,
  HOUR_MS,
  MATIC_USDT_END_MS,
  POL_USDT_START_MS,
} from './constants';
import { sleep } from './utils';

const FETCH_TIMEOUT_MS = 10_000; // 10s timeout per Binance request
const MAX_RETRY_ROUNDS = 3; // Try each host up to 4 times total (initial + 3 retries)
const RETRY_DELAY_MS = 500; // Fixed delay between retry rounds

export type BinanceSymbol = 'MATICUSDT' | 'POLUSDT';

// Parsed hourly candle (from raw kline array: index 0 = openTime ms, index 4 = close string)
export interface Kline {
  openTimeMs: number;
  close: number;
}

// One hourly price row destined for pol_prices
export interface HourlyPriceRow {
  tsMs: number;
  priceUsd: number;
  source: string; // 'binance:MATICUSDT' | 'binance:POLUSDT' | 'carry_forward'
}

/**
 * Thrown when Binance returns HTTP 451 (Unavailable For Legal Reasons).
 * This means Binance geo-blocked the caller's IP - retrying other api*.binance.com
 * hosts is pointless (the block is IP-based), so this aborts immediately.
 */
export class BinanceGeoBlockedError extends Error {
  constructor(host: string) {
    super(
      `Binance geo-blocked this IP (HTTP 451 from ${host}). ` +
      `Price fetching is unavailable from this server's location; ` +
      `set BINANCE_API_URLS to a reachable mirror or run from a non-blocked region.`
    );
    this.name = 'BinanceGeoBlockedError';
  }
}

export class BinanceExhaustedError extends Error {
  constructor(message: string, public lastError?: Error) {
    super(message);
    this.name = 'BinanceExhaustedError';
  }
}

// Raw kline array from GET /api/v3/klines
// [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBase, takerQuote, ignore]
type RawKline = [number, string, string, string, string, ...unknown[]];

function parseKline(raw: RawKline): Kline {
  const openTimeMs = Number(raw[0]);
  const close = Number(raw[4]);
  if (!Number.isFinite(openTimeMs) || !Number.isFinite(close)) {
    throw new Error(`Invalid Binance kline: ${JSON.stringify(raw)}`);
  }
  return { openTimeMs, close };
}

/**
 * Fetch klines with host rotation and retry (mirrors HeimdallClient.fetch).
 * Each call starts at the first host and rotates on failure; HTTP 451 aborts immediately.
 */
async function fetchKlines(params: URLSearchParams): Promise<Kline[]> {
  let lastError: Error | undefined;

  for (let retry = 0; retry <= MAX_RETRY_ROUNDS; retry++) {
    for (const host of BINANCE_API_URLS) {
      try {
        const url = `${host}/api/v3/klines?${params.toString()}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (response.status === 451) {
          throw new BinanceGeoBlockedError(host);
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = (await response.json()) as RawKline[];
        return data.map(parseKline);
      } catch (error) {
        if (error instanceof BinanceGeoBlockedError) {
          console.error(`[Binance] ${error.message}`);
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`Binance ${host} failed (retry ${retry + 1}/${MAX_RETRY_ROUNDS + 1}): ${lastError.message}`);
      }
    }

    if (retry < MAX_RETRY_ROUNDS) {
      await sleep(RETRY_DELAY_MS);
    }
  }

  console.error(`All ${BINANCE_API_URLS.length} Binance hosts failed after ${MAX_RETRY_ROUNDS + 1} retry rounds`);
  throw new BinanceExhaustedError(
    `All Binance hosts failed after ${MAX_RETRY_ROUNDS + 1} retry rounds`,
    lastError
  );
}

/**
 * Fetch hourly klines for a symbol in [startTimeMs, endTimeMs] (openTime, both inclusive).
 */
export async function getKlines(
  symbol: BinanceSymbol,
  startTimeMs: number,
  endTimeMs: number,
  limit: number = BINANCE_KLINE_LIMIT
): Promise<Kline[]> {
  return fetchKlines(new URLSearchParams({
    symbol,
    interval: '1h',
    startTime: String(startTimeMs),
    endTime: String(endTimeMs),
    limit: String(limit),
  }));
}

/**
 * Fetch the most recent hourly klines (no time range). The last kline returned is
 * the in-progress current-hour candle.
 */
export async function getLatestKlines(symbol: BinanceSymbol, limit: number): Promise<Kline[]> {
  return fetchKlines(new URLSearchParams({
    symbol,
    interval: '1h',
    limit: String(limit),
  }));
}

/**
 * Which Binance symbol trades at a given hour.
 * MATICUSDT until delisting; POLUSDT from listing; null in the 3-day delisting gap.
 */
export function symbolForHour(tsMs: number): BinanceSymbol | null {
  if (tsMs < MATIC_USDT_END_MS) return 'MATICUSDT';
  if (tsMs >= POL_USDT_START_MS) return 'POLUSDT';
  return null;
}

/**
 * Build gap-free hourly price rows for [fromHourMs, toHourMs) (hour-aligned bounds).
 *
 * - Hours with a kline get that close, source derived from symbolForHour().
 * - Hours without a kline get lastKnownPrice carried forward (source 'carry_forward') -
 *   this fills the 3-day MATIC->POL delisting gap.
 * - Leading hours are skipped while no price is known yet (lastKnownPrice null and
 *   no kline seen so far).
 */
export function buildHourlyPriceRows(
  klines: Kline[],
  fromHourMs: number,
  toHourMs: number,
  lastKnownPrice: number | null
): HourlyPriceRow[] {
  const closeByHour = new Map<number, number>();
  for (const k of klines) {
    closeByHour.set(k.openTimeMs, k.close);
  }

  const rows: HourlyPriceRow[] = [];
  let last = lastKnownPrice;

  for (let ts = fromHourMs; ts < toHourMs; ts += HOUR_MS) {
    const symbol = symbolForHour(ts);
    // A kline only counts if a symbol legitimately trades at this hour
    // (klines inside the delisting gap would have wrong provenance).
    const close = symbol !== null ? closeByHour.get(ts) : undefined;

    if (close !== undefined) {
      rows.push({ tsMs: ts, priceUsd: close, source: `binance:${symbol}` });
      last = close;
    } else if (last !== null) {
      rows.push({ tsMs: ts, priceUsd: last, source: 'carry_forward' });
    }
    // last === null and no kline: skip until a first price is known
  }

  return rows;
}
