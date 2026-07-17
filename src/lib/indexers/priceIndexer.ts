import {
  getKlines,
  getLatestKlines,
  buildHourlyPriceRows,
  Kline,
} from '../binance';
import {
  BINANCE_KLINE_LIMIT,
  HOUR_MS,
  MATIC_USDT_END_MS,
  POL_USDT_START_MS,
  PRICE_BACKFILL_DELAY_MS,
  PRICE_HISTORY_START_MS,
  PRICE_POLL_MS,
} from '../constants';
import { upsertPricesBatch, getLatestPrice, getPriceCoverage } from '../queries/prices';
import { getIndexerState, updateIndexerState, initializeIndexerState } from './indexerState';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from '../workers/workerStatus';
import { sleep } from '../utils';

const SERVICE_NAME = 'price_indexer';
const WORKER_NAME = 'PriceIndexer';

// Switch to backfill mode when the cursor is more than 2 hours behind now
const BACKFILL_THRESHOLD_MS = 2 * HOUR_MS;
// Steady mode fetches the last closed candle + the in-progress current-hour candle
const STEADY_FETCH_LIMIT = 2;

export type PriceIndexerMode = 'backfill' | 'steady';

/**
 * Price Indexer - Self-backfilling hourly POL/MATIC price indexer.
 *
 * Fetches hourly close prices from Binance public klines (MATICUSDT until the
 * 2024-09-10 delisting, POLUSDT from the 2024-09-13 listing; the 3-day gap is
 * carry-forward-filled) and upserts them into pol_prices.
 *
 * Cursor semantics: epoch-SECONDS of the last CLOSED hourly candle, stored in
 * indexer_state.last_block (precedent: milestone workers store sequence ids there).
 */
export class PriceIndexer {
  private cursorSec: number | null = null;
  private lastKnownPrice: number | null = null;
  private running = false;
  private pollMs = PRICE_POLL_MS;

  /** Current cursor (epoch seconds of last closed candle). Exposed for tests/status. */
  get cursor(): number | null {
    return this.cursorSec;
  }

  /**
   * Start the price indexer.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    initWorkerStatus(WORKER_NAME);
    updateWorkerState(WORKER_NAME, 'running');

    console.log(`[${WORKER_NAME}] Starting price indexer`);
    console.log(`[${WORKER_NAME}] Poll interval: ${this.pollMs}ms, Backfill batch: ${BINANCE_KLINE_LIMIT} candles`);

    await this.init();

    // Start main loop (catch to prevent unhandled rejection if loop somehow throws past try/catch)
    this.runLoop().catch(err => {
      console.error(`[${WORKER_NAME}] runLoop exited with error:`, err);
      updateWorkerError(WORKER_NAME, err instanceof Error ? err.message : String(err));
    });
  }

  /**
   * Stop the price indexer.
   */
  stop(): void {
    this.running = false;
    updateWorkerState(WORKER_NAME, 'stopped');
    console.log(`[${WORKER_NAME}] Stopped`);
  }

  /**
   * Resolve the cursor: indexer_state -> MAX(ts) in pol_prices -> PRICE_HISTORY_START.
   * Separated from start() so tests can initialize without launching the loop.
   */
  async init(): Promise<void> {
    const state = await getIndexerState(SERVICE_NAME);

    if (state) {
      this.cursorSec = Number(state.blockNumber);
      console.log(`[${WORKER_NAME}] Resumed from cursor ${new Date(this.cursorSec * 1000).toISOString()}`);
    } else {
      const coverage = await getPriceCoverage();

      if (coverage.maxTs) {
        // Resume from existing price data
        this.cursorSec = Math.floor(coverage.maxTs.getTime() / 1000);
        await initializeIndexerState(SERVICE_NAME, BigInt(this.cursorSec), '');
        console.log(`[${WORKER_NAME}] Initialized from existing prices at ${coverage.maxTs.toISOString()}`);
      } else {
        // Fresh start: one hour BEFORE history start, so the first backfill window
        // (which begins at cursor + 1h) includes the very first hour of history.
        this.cursorSec = Math.floor((PRICE_HISTORY_START_MS - HOUR_MS) / 1000);
        await initializeIndexerState(SERVICE_NAME, BigInt(this.cursorSec), '');
        console.log(`[${WORKER_NAME}] Initialized at price history start ${new Date(PRICE_HISTORY_START_MS).toISOString()}`);
      }
    }

    const latest = await getLatestPrice();
    this.lastKnownPrice = latest ? latest.priceUsd : null;
  }

  /**
   * Main indexing loop. Errors (including Binance 451 geo-block) are logged via
   * worker status and the loop keeps running - never crash the container.
   */
  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const mode = await this.tick();
        await sleep(mode === 'backfill' ? PRICE_BACKFILL_DELAY_MS : this.pollMs);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[${WORKER_NAME}] Error:`, errorMsg);
        updateWorkerError(WORKER_NAME, errorMsg);
        await sleep(this.pollMs);
      }
    }
  }

  /**
   * One loop iteration: backfill step when >2h behind, steady step otherwise.
   * Public so tests can drive single iterations.
   */
  async tick(): Promise<PriceIndexerMode> {
    if (this.cursorSec === null) {
      throw new Error(`[${WORKER_NAME}] tick() called before init()`);
    }

    const nowMs = Date.now();
    const cursorMs = this.cursorSec * 1000;

    if (nowMs - cursorMs > BACKFILL_THRESHOLD_MS) {
      await this.backfillStep(nowMs, cursorMs);
      return 'backfill';
    }

    await this.steadyStep(nowMs);
    return 'steady';
  }

  /**
   * Backfill one window of up to BINANCE_KLINE_LIMIT hourly candles from cursor + 1h.
   * Symbol routing: MATICUSDT before the delisting (fetch endTime clamped there),
   * POLUSDT from the listing (fetch startTime clamped there); the gap between them
   * produces no klines and is carry-forward-filled by buildHourlyPriceRows.
   */
  private async backfillStep(nowMs: number, cursorMs: number): Promise<void> {
    const lastClosedHourMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS - HOUR_MS;
    const fromHourMs = Math.floor(cursorMs / HOUR_MS) * HOUR_MS + HOUR_MS;
    // Exclusive end of the requested window: capped at batch size and at closed candles
    const windowEndMs = Math.min(fromHourMs + BINANCE_KLINE_LIMIT * HOUR_MS, lastClosedHourMs + HOUR_MS);
    if (windowEndMs <= fromHourMs) return;

    let klines: Kline[] = [];
    let rowWindowEndMs = windowEndMs;

    if (fromHourMs < MATIC_USDT_END_MS) {
      // MATIC era: clamp fetch endTime at the delisting; the row window may extend
      // across the delisting gap (those hours become carry-forward rows) but stops
      // before the POL listing so POL-era hours get real POLUSDT candles next batch.
      const fetchEndMs = Math.min(windowEndMs, MATIC_USDT_END_MS);
      rowWindowEndMs = Math.min(windowEndMs, POL_USDT_START_MS);
      klines = await getKlines('MATICUSDT', fromHourMs, fetchEndMs - 1, BINANCE_KLINE_LIMIT);
    } else {
      // Delisting gap or POL era: clamp fetch startTime at the POL listing
      // (gap hours before it are carry-forward-filled).
      const fetchStartMs = Math.max(fromHourMs, POL_USDT_START_MS);
      if (windowEndMs > fetchStartMs) {
        klines = await getKlines('POLUSDT', fetchStartMs, windowEndMs - 1, BINANCE_KLINE_LIMIT);
      }
    }

    const rows = buildHourlyPriceRows(klines, fromHourMs, rowWindowEndMs, this.lastKnownPrice);
    if (rows.length > 0) {
      await upsertPricesBatch(rows);
      this.lastKnownPrice = rows[rows.length - 1].priceUsd;
    }

    // Advance past the whole row window (all hours in it are closed); hours that
    // produced no row (no kline and no known price yet) are unfillable by design.
    this.cursorSec = Math.floor((rowWindowEndMs - HOUR_MS) / 1000);
    await updateIndexerState(SERVICE_NAME, BigInt(this.cursorSec), '');
    updateWorkerRun(WORKER_NAME, rows.length);

    console.log(`[${WORKER_NAME}] Backfilled ${rows.length} hourly prices up to ${new Date(this.cursorSec * 1000).toISOString()}`);
  }

  /**
   * Steady step: fetch the 2 most recent POLUSDT candles and upsert both.
   * The in-progress current-hour candle is included (overwritten each poll);
   * the cursor only advances past CLOSED candles (openTime + 1h <= now).
   */
  private async steadyStep(nowMs: number): Promise<void> {
    const klines = await getLatestKlines('POLUSDT', STEADY_FETCH_LIMIT);
    if (klines.length === 0) return;

    const rows = klines.map(k => ({
      tsMs: k.openTimeMs,
      priceUsd: k.close,
      source: 'binance:POLUSDT',
    }));
    await upsertPricesBatch(rows);
    this.lastKnownPrice = rows[rows.length - 1].priceUsd;

    const closedOpenTimes = klines
      .filter(k => k.openTimeMs + HOUR_MS <= nowMs)
      .map(k => k.openTimeMs);

    if (closedOpenTimes.length > 0) {
      const newCursorSec = Math.floor(Math.max(...closedOpenTimes) / 1000);
      if (this.cursorSec === null || newCursorSec > this.cursorSec) {
        this.cursorSec = newCursorSec;
        await updateIndexerState(SERVICE_NAME, BigInt(this.cursorSec), '');
      }
    }

    updateWorkerRun(WORKER_NAME, rows.length);
  }
}

// Singleton instance
let priceIndexerInstance: PriceIndexer | null = null;

/**
 * Get the singleton PriceIndexer instance.
 */
export function getPriceIndexer(): PriceIndexer {
  if (!priceIndexerInstance) {
    priceIndexerInstance = new PriceIndexer();
  }
  return priceIndexerInstance;
}
