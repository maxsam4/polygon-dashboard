import { query, queryOne } from '../db';
import { PolPrice } from '../types';
import { HourlyPriceRow } from '../binance';

interface PolPriceRow {
  ts: Date | string;
  price_usd: number;
  source: string;
}

/**
 * Upsert a batch of hourly price rows into pol_prices with a single
 * multi-VALUES INSERT. Re-upserting an existing hour overwrites price/source
 * (the in-progress current-hour candle is refreshed each poll).
 */
export async function upsertPricesBatch(rows: HourlyPriceRow[]): Promise<void> {
  if (rows.length === 0) return;

  const values: string[] = [];
  const params: (string | number)[] = [];

  rows.forEach((row, i) => {
    const base = i * 3;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
    params.push(new Date(row.tsMs).toISOString(), row.priceUsd, row.source);
  });

  await query(
    `INSERT INTO pol_prices (ts, price_usd, source)
     VALUES ${values.join(', ')}
     ON CONFLICT (ts) DO UPDATE SET
       price_usd = EXCLUDED.price_usd,
       source = EXCLUDED.source,
       updated_at = NOW()`,
    params
  );
}

/**
 * Get the most recent price row (may be the in-progress current-hour candle).
 */
export async function getLatestPrice(): Promise<PolPrice | null> {
  const row = await queryOne<PolPriceRow>(
    `SELECT ts, price_usd, source FROM pol_prices ORDER BY ts DESC LIMIT 1`
  );
  if (!row) return null;
  return {
    ts: new Date(row.ts),
    priceUsd: row.price_usd,
    source: row.source,
  };
}

/**
 * Get coverage of the price series (min/max hour and row count).
 */
export async function getPriceCoverage(): Promise<{ minTs: Date | null; maxTs: Date | null; count: number }> {
  const row = await queryOne<{ min_ts: Date | string | null; max_ts: Date | string | null; count: string | number }>(
    `SELECT MIN(ts) AS min_ts, MAX(ts) AS max_ts, COUNT(*) AS count FROM pol_prices`
  );
  return {
    minTs: row?.min_ts ? new Date(row.min_ts) : null,
    maxTs: row?.max_ts ? new Date(row.max_ts) : null,
    count: row ? Number(row.count) : 0,
  };
}
