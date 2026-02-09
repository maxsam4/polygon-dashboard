import { query } from '../db';
import { ChartDataPoint } from '../types';

type BucketSize = '2s' | '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

const BUCKET_INTERVALS: Record<BucketSize, string> = {
  '2s': '2 seconds',
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '4h': '4 hours',
  '1d': '1 day',
  '1w': '1 week',
};

// Map bucket sizes to source table and whether to re-aggregate
type AggSource = {
  table: 'blocks' | 'blocks_1min_agg' | 'blocks_1hour_agg';
  needsRollup: boolean;
};

const AGG_SOURCE: Record<BucketSize, AggSource> = {
  '2s': { table: 'blocks', needsRollup: true },           // Real-time, use raw
  '1m': { table: 'blocks_1min_agg', needsRollup: false }, // Direct match
  '5m': { table: 'blocks_1min_agg', needsRollup: true },  // Roll up 5x
  '15m': { table: 'blocks_1min_agg', needsRollup: true }, // Roll up 15x
  '1h': { table: 'blocks_1hour_agg', needsRollup: false },// Direct match
  '4h': { table: 'blocks_1hour_agg', needsRollup: true }, // Roll up 4x
  '1d': { table: 'blocks_1hour_agg', needsRollup: true }, // Roll up 24x
  '1w': { table: 'blocks_1hour_agg', needsRollup: true }, // Roll up 168x
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
  priority_fee_median: number | null;
  priority_fee_open: number;
  priority_fee_close: number;
  total_gas_price_avg: number;
  total_gas_price_min: number;
  total_gas_price_max: number;
  total_base_fee_sum: number;
  total_priority_fee_sum: number;
  gas_used_sum: number;
  gas_limit_sum: number;
  mgas_per_sec: number;
  tps: number;
  finality_avg: number | null;
  finality_min: number | null;
  finality_max: number | null;
  block_time_avg: number | null;
  block_time_min: number | null;
  block_time_max: number | null;
}

/**
 * Get chart data using continuous aggregates for performance.
 * Uses pre-computed 1-minute and 1-hour aggregates when possible.
 */
export async function getChartData(
  fromTime: Date,
  toTime: Date,
  bucketSize: BucketSize,
  page = 1,
  limit = 500
): Promise<{ data: ChartDataPoint[]; total: number }> {
  const interval = BUCKET_INTERVALS[bucketSize];
  const offset = (page - 1) * limit;
  const source = AGG_SOURCE[bucketSize];

  // Try to use continuous aggregate, fall back to raw table if not available
  const rows = await getChartDataFromSource(source, interval, fromTime, toTime, limit, offset);

  // Estimate total (avoid expensive COUNT on large ranges)
  const timeRangeMs = toTime.getTime() - fromTime.getTime();
  const bucketMs = getBucketMs(bucketSize);
  const total = Math.ceil(timeRangeMs / bucketMs);

  const data: ChartDataPoint[] = rows.map((row) => ({
    timestamp: Math.floor(new Date(row.bucket).getTime() / 1000),
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
      median: row.priority_fee_median ?? row.priority_fee_avg, // Fallback for aggregates
      open: row.priority_fee_open,
      close: row.priority_fee_close,
    },
    total: {
      avg: row.total_gas_price_avg,
      min: row.total_gas_price_min,
      max: row.total_gas_price_max,
    },
    totalBaseFeeSum: row.total_base_fee_sum ?? 0,
    totalPriorityFeeSum: row.total_priority_fee_sum ?? 0,
    gasUsedSum: row.gas_used_sum ?? 0,
    gasLimitSum: row.gas_limit_sum ?? 0,
    mgasPerSec: row.mgas_per_sec ?? 0,
    tps: row.tps ?? 0,
    finalityAvg: row.finality_avg,
    finalityMin: row.finality_min,
    finalityMax: row.finality_max,
    blockTimeAvg: row.block_time_avg,
    blockTimeMin: row.block_time_min,
    blockTimeMax: row.block_time_max,
  }));

  return { data, total };
}

function getBucketMs(bucketSize: BucketSize): number {
  const map: Record<BucketSize, number> = {
    '2s': 2000,
    '1m': 60000,
    '5m': 300000,
    '15m': 900000,
    '1h': 3600000,
    '4h': 14400000,
    '1d': 86400000,
    '1w': 604800000,
  };
  return map[bucketSize];
}

async function getChartDataFromSource(
  source: AggSource,
  interval: string,
  fromTime: Date,
  toTime: Date,
  limit: number,
  offset: number
): Promise<ChartRow[]> {
  // Query for raw blocks table (includes PERCENTILE_CONT for median)
  if (source.table === 'blocks') {
    return query<ChartRow>(
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
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY avg_priority_fee_gwei) AS priority_fee_median,
        (array_agg(avg_priority_fee_gwei ORDER BY timestamp))[1] AS priority_fee_open,
        (array_agg(avg_priority_fee_gwei ORDER BY timestamp DESC))[1] AS priority_fee_close,
        AVG(base_fee_gwei + avg_priority_fee_gwei) AS total_gas_price_avg,
        MIN(base_fee_gwei + min_priority_fee_gwei) AS total_gas_price_min,
        MAX(base_fee_gwei + max_priority_fee_gwei) AS total_gas_price_max,
        SUM(total_base_fee_gwei) AS total_base_fee_sum,
        SUM(total_priority_fee_gwei) AS total_priority_fee_sum,
        SUM(gas_used) AS gas_used_sum,
        SUM(gas_limit) AS gas_limit_sum,
        SUM(gas_used)::DOUBLE PRECISION / NULLIF(SUM(block_time_sec), 0) / 1000000 AS mgas_per_sec,
        SUM(tx_count)::DOUBLE PRECISION / NULLIF(SUM(block_time_sec), 0) AS tps,
        AVG(time_to_finality_sec) FILTER (WHERE finalized) AS finality_avg,
        MIN(time_to_finality_sec) FILTER (WHERE finalized) AS finality_min,
        MAX(time_to_finality_sec) FILTER (WHERE finalized) AS finality_max,
        AVG(block_time_sec) AS block_time_avg,
        MIN(block_time_sec) AS block_time_min,
        MAX(block_time_sec) AS block_time_max
      FROM blocks
      WHERE timestamp >= $2 AND timestamp <= $3
      GROUP BY bucket
      ORDER BY bucket
      LIMIT $4 OFFSET $5`,
      [interval, fromTime, toTime, limit, offset]
    );
  }

  // Query for continuous aggregates (roll up pre-aggregated data)
  const table = source.table;
  const needsRollup = source.needsRollup;

  if (!needsRollup) {
    // Direct query from continuous aggregate (exact bucket match)
    return query<ChartRow>(
      `SELECT
        bucket,
        block_start::text AS block_start,
        block_end::text AS block_end,
        block_count::text AS block_count,
        base_fee_open,
        base_fee_high,
        base_fee_low,
        base_fee_close,
        base_fee_avg,
        priority_fee_avg,
        priority_fee_min,
        priority_fee_max,
        NULL::double precision AS priority_fee_median,
        priority_fee_open,
        priority_fee_close,
        total_gas_price_avg,
        total_gas_price_min,
        total_gas_price_max,
        total_base_fee_sum,
        total_priority_fee_sum,
        gas_used_sum,
        gas_limit_sum,
        gas_used_sum::DOUBLE PRECISION / NULLIF(block_time_sum, 0) / 1000000 AS mgas_per_sec,
        tx_count_sum::DOUBLE PRECISION / NULLIF(block_time_sum, 0) AS tps,
        finality_avg,
        finality_min,
        finality_max,
        block_time_sum::DOUBLE PRECISION / NULLIF(block_count, 0) AS block_time_avg,
        NULL::double precision AS block_time_min,
        NULL::double precision AS block_time_max
      FROM ${table}
      WHERE bucket >= $1 AND bucket <= $2
      ORDER BY bucket
      LIMIT $3 OFFSET $4`,
      [fromTime, toTime, limit, offset]
    );
  }

  // Roll up from continuous aggregate to larger bucket
  return query<ChartRow>(
    `SELECT
      time_bucket($1::interval, bucket) AS bucket,
      MIN(block_start)::text AS block_start,
      MAX(block_end)::text AS block_end,
      SUM(block_count)::text AS block_count,
      (array_agg(base_fee_open ORDER BY bucket))[1] AS base_fee_open,
      MAX(base_fee_high) AS base_fee_high,
      MIN(base_fee_low) AS base_fee_low,
      (array_agg(base_fee_close ORDER BY bucket DESC))[1] AS base_fee_close,
      SUM(base_fee_avg * block_count) / NULLIF(SUM(block_count), 0) AS base_fee_avg,
      SUM(priority_fee_avg * block_count) / NULLIF(SUM(block_count), 0) AS priority_fee_avg,
      MIN(priority_fee_min) AS priority_fee_min,
      MAX(priority_fee_max) AS priority_fee_max,
      NULL::double precision AS priority_fee_median,
      (array_agg(priority_fee_open ORDER BY bucket))[1] AS priority_fee_open,
      (array_agg(priority_fee_close ORDER BY bucket DESC))[1] AS priority_fee_close,
      SUM(total_gas_price_avg * block_count) / NULLIF(SUM(block_count), 0) AS total_gas_price_avg,
      MIN(total_gas_price_min) AS total_gas_price_min,
      MAX(total_gas_price_max) AS total_gas_price_max,
      SUM(total_base_fee_sum) AS total_base_fee_sum,
      SUM(total_priority_fee_sum) AS total_priority_fee_sum,
      SUM(gas_used_sum) AS gas_used_sum,
      SUM(gas_limit_sum) AS gas_limit_sum,
      SUM(gas_used_sum)::DOUBLE PRECISION / NULLIF(SUM(block_time_sum), 0) / 1000000 AS mgas_per_sec,
      SUM(tx_count_sum)::DOUBLE PRECISION / NULLIF(SUM(block_time_sum), 0) AS tps,
      SUM(finality_avg * finalized_count) / NULLIF(SUM(finalized_count), 0) AS finality_avg,
      MIN(finality_min) AS finality_min,
      MAX(finality_max) AS finality_max,
      SUM(block_time_sum)::DOUBLE PRECISION / NULLIF(SUM(block_count), 0) AS block_time_avg,
      NULL::double precision AS block_time_min,
      NULL::double precision AS block_time_max
    FROM ${table}
    WHERE bucket >= $2 AND bucket <= $3
    GROUP BY time_bucket($1::interval, bucket)
    ORDER BY bucket
    LIMIT $4 OFFSET $5`,
    [interval, fromTime, toTime, limit, offset]
  );
}

