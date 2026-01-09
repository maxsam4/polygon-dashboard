import { query } from '../db';
import { ChartDataPoint } from '../types';

type BucketSize = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

const BUCKET_INTERVALS: Record<BucketSize, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '4h': '4 hours',
  '1d': '1 day',
  '1w': '1 week',
};

interface ChartRow {
  bucket: Date;
  block_start: string;
  block_end: string;
  block_count: string;
  base_fee_open: number;
  base_fee_high: number;
  base_fee_low: number;
  base_fee_close: number;
  base_fee_avg: number;
  priority_fee_avg: number;
  priority_fee_min: number;
  priority_fee_max: number;
  priority_fee_open: number;
  priority_fee_close: number;
  total_gas_price_avg: number;
  total_gas_price_min: number;
  total_gas_price_max: number;
  mgas_per_sec: number;
  tps: number;
  finality_avg: number | null;
  finality_min: number | null;
  finality_max: number | null;
}

export async function getChartData(
  fromTime: Date,
  toTime: Date,
  bucketSize: BucketSize,
  page = 1,
  limit = 500
): Promise<{ data: ChartDataPoint[]; total: number }> {
  const interval = BUCKET_INTERVALS[bucketSize];
  const offset = (page - 1) * limit;

  // Count total buckets
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT time_bucket($1::interval, timestamp)) as count
     FROM blocks
     WHERE timestamp >= $2 AND timestamp <= $3`,
    [interval, fromTime, toTime]
  );
  const total = parseInt(countResult[0]?.count ?? '0', 10);

  // Get aggregated data
  const rows = await query<ChartRow>(
    `SELECT
      time_bucket($1::interval, timestamp) AS bucket,
      MIN(block_number) AS block_start,
      MAX(block_number) AS block_end,
      COUNT(*) AS block_count,

      (array_agg(base_fee_gwei ORDER BY timestamp))[1] AS base_fee_open,
      MAX(base_fee_gwei) AS base_fee_high,
      MIN(base_fee_gwei) AS base_fee_low,
      (array_agg(base_fee_gwei ORDER BY timestamp DESC))[1] AS base_fee_close,
      AVG(base_fee_gwei) AS base_fee_avg,

      AVG(avg_priority_fee_gwei) AS priority_fee_avg,
      MIN(min_priority_fee_gwei) AS priority_fee_min,
      MAX(max_priority_fee_gwei) AS priority_fee_max,
      (array_agg(avg_priority_fee_gwei ORDER BY timestamp))[1] AS priority_fee_open,
      (array_agg(avg_priority_fee_gwei ORDER BY timestamp DESC))[1] AS priority_fee_close,

      AVG(base_fee_gwei + avg_priority_fee_gwei) AS total_gas_price_avg,
      MIN(base_fee_gwei + min_priority_fee_gwei) AS total_gas_price_min,
      MAX(base_fee_gwei + max_priority_fee_gwei) AS total_gas_price_max,

      SUM(gas_used)::DOUBLE PRECISION / NULLIF(SUM(block_time_sec), 0) / 1000000 AS mgas_per_sec,
      SUM(tx_count)::DOUBLE PRECISION / NULLIF(SUM(block_time_sec), 0) AS tps,

      AVG(time_to_finality_sec) FILTER (WHERE finalized) AS finality_avg,
      MIN(time_to_finality_sec) FILTER (WHERE finalized) AS finality_min,
      MAX(time_to_finality_sec) FILTER (WHERE finalized) AS finality_max

    FROM blocks
    WHERE timestamp >= $2 AND timestamp <= $3
    GROUP BY bucket
    ORDER BY bucket
    LIMIT $4 OFFSET $5`,
    [interval, fromTime, toTime, limit, offset]
  );

  const data: ChartDataPoint[] = rows.map((row) => ({
    timestamp: row.bucket.getTime() / 1000,
    blockStart: parseInt(row.block_start, 10),
    blockEnd: parseInt(row.block_end, 10),
    baseFee: {
      open: row.base_fee_open,
      high: row.base_fee_high,
      low: row.base_fee_low,
      close: row.base_fee_close,
      avg: row.base_fee_avg,
    },
    priorityFee: {
      avg: row.priority_fee_avg,
      min: row.priority_fee_min,
      max: row.priority_fee_max,
      open: row.priority_fee_open,
      close: row.priority_fee_close,
    },
    total: {
      avg: row.total_gas_price_avg,
      min: row.total_gas_price_min,
      max: row.total_gas_price_max,
    },
    mgasPerSec: row.mgas_per_sec ?? 0,
    tps: row.tps ?? 0,
    finalityAvg: row.finality_avg,
    finalityMin: row.finality_min,
    finalityMax: row.finality_max,
  }));

  return { data, total };
}
