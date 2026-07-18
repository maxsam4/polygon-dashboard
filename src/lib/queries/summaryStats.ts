import { queryOne } from '../db';
import { SummaryStats } from '../types';
import { GWEI_PER_POL } from '../constants';
import { getLatestPrice } from './prices';
import { getAllInflationRates } from './inflation';
import {
  prepareRatesForCalculation,
  calculateBucketIssuance,
  calculateSupplyAt,
  findRateAt,
  weiToPol,
  annualize,
} from '../inflationCalc';

type StatsSource = SummaryStats['source'];

// Source routing thresholds (age-aware: raw `blocks` chunks compress after 35 days,
// so raw queries are gated to recent, short windows — far inside the uncompressed range)
const RAW_MAX_RANGE_SEC = 6 * 3600; // raw blocks only for ranges <= 6h...
const RAW_MAX_AGE_SEC = 24 * 3600; // ...that start within the last 24h
const MIN_AGG_MAX_RANGE_SEC = 7 * 24 * 3600; // above this, minute rows are too many — use hourly

/**
 * One row returned by the aggregate query (same shape for all three sources).
 * pg returns SUM(bigint)/COUNT as strings (numeric/bigint) and SUM(double) as numbers.
 */
interface SummaryRow {
  base_fee_gwei_sum: string | number | null;
  priority_fee_gwei_sum: string | number | null;
  base_fee_usd_sum: string | number | null;
  priority_fee_usd_sum: string | number | null;
  usd_missing_hours: string | number | null;
  gas_used_sum: string | number | null;
  gas_limit_sum: string | number | null;
  tx_count_sum: string | number | null;
  block_count: string | number | null;
  block_time_sum: string | number | null;
  block_start: string | number | null;
  block_end: string | number | null;
  finality_avg: string | number | null;
  peak_tps: string | number | null;
  peak_mgas: string | number | null;
  data_end: Date | string | null;
  base_fee_gwei_avg: string | number | null;
  median_priority_fee_gwei_avg: string | number | null;
  total_fee_gwei_avg: string | number | null;
}

function toNum(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Earliest data timestamp (epoch seconds), from the 1hour continuous aggregate.
 * Used to clamp the "ALL" range (from <= 0 or predating data).
 */
async function getEarliestBucketSec(): Promise<number | null> {
  const row = await queryOne<{ min_bucket: Date | null }>(
    `SELECT MIN(bucket) AS min_bucket FROM blocks_1hour_agg`
  );
  if (!row || !row.min_bucket) return null;
  return Math.floor(new Date(row.min_bucket).getTime() / 1000);
}

/**
 * Run the single aggregate query for the chosen source.
 * All metrics (POL fees, USD fees, gas, tx, peaks, finality) come from the same
 * source rows over the same snapped window, so they are internally consistent.
 * The pol_prices join happens at source-row granularity, inside the aggregation.
 */
async function fetchSummaryRow(
  source: StatsSource,
  fromDate: Date,
  toDate: Date
): Promise<SummaryRow | null> {
  if (source === 'blocks') {
    return queryOne<SummaryRow>(
      `SELECT
        SUM(b.total_base_fee_gwei) AS base_fee_gwei_sum,
        SUM(b.total_priority_fee_gwei) AS priority_fee_gwei_sum,
        SUM(b.total_base_fee_gwei * p.price_usd) / 1e9 AS base_fee_usd_sum,
        SUM(b.total_priority_fee_gwei * p.price_usd) / 1e9 AS priority_fee_usd_sum,
        COUNT(DISTINCT date_trunc('hour', b.timestamp)) FILTER (WHERE p.price_usd IS NULL) AS usd_missing_hours,
        SUM(b.gas_used) AS gas_used_sum,
        SUM(b.gas_limit) AS gas_limit_sum,
        SUM(b.tx_count) AS tx_count_sum,
        COUNT(*) AS block_count,
        SUM(b.block_time_sec) AS block_time_sum,
        MIN(b.block_number) AS block_start,
        MAX(b.block_number) AS block_end,
        AVG(b.time_to_finality_sec) FILTER (WHERE b.finalized) AS finality_avg,
        MAX(b.tps) AS peak_tps,
        MAX(b.mgas_per_sec) AS peak_mgas,
        MAX(b.timestamp) AS data_end,
        AVG(b.base_fee_gwei) AS base_fee_gwei_avg,
        AVG(b.median_priority_fee_gwei) AS median_priority_fee_gwei_avg,
        AVG(b.base_fee_gwei + b.avg_priority_fee_gwei) AS total_fee_gwei_avg
      FROM blocks b
      LEFT JOIN pol_prices p ON p.ts = date_trunc('hour', b.timestamp)
      WHERE b.timestamp >= $1 AND b.timestamp < $2`,
      [fromDate, toDate]
    );
  }

  if (source === 'blocks_1min_agg') {
    return queryOne<SummaryRow>(
      `SELECT
        SUM(a.total_base_fee_sum) AS base_fee_gwei_sum,
        SUM(a.total_priority_fee_sum) AS priority_fee_gwei_sum,
        SUM(a.total_base_fee_sum * p.price_usd) / 1e9 AS base_fee_usd_sum,
        SUM(a.total_priority_fee_sum * p.price_usd) / 1e9 AS priority_fee_usd_sum,
        COUNT(DISTINCT date_trunc('hour', a.bucket)) FILTER (WHERE p.price_usd IS NULL) AS usd_missing_hours,
        SUM(a.gas_used_sum) AS gas_used_sum,
        SUM(a.gas_limit_sum) AS gas_limit_sum,
        SUM(a.tx_count_sum) AS tx_count_sum,
        SUM(a.block_count) AS block_count,
        SUM(a.block_time_sum) AS block_time_sum,
        MIN(a.block_start) AS block_start,
        MAX(a.block_end) AS block_end,
        SUM(a.finality_avg * a.finalized_count) / NULLIF(SUM(a.finalized_count), 0) AS finality_avg,
        MAX(a.tps_max) AS peak_tps,
        MAX(a.mgas_per_sec_max) AS peak_mgas,
        LEAST(MAX(a.bucket) + INTERVAL '1 minute', $2) AS data_end,
        SUM(a.base_fee_avg * a.block_count) / NULLIF(SUM(a.block_count), 0) AS base_fee_gwei_avg,
        SUM(a.median_priority_fee_avg * a.block_count) / NULLIF(SUM(a.block_count), 0) AS median_priority_fee_gwei_avg,
        SUM(a.total_gas_price_avg * a.block_count) / NULLIF(SUM(a.block_count), 0) AS total_fee_gwei_avg
      FROM blocks_1min_agg a
      LEFT JOIN pol_prices p ON p.ts = date_trunc('hour', a.bucket)
      WHERE a.bucket >= $1 AND a.bucket < $2`,
      [fromDate, toDate]
    );
  }

  // blocks_1hour_agg — freshness fix: the 1hour aggregate materializes up to ~2h
  // behind now, so hours after its last materialized bucket are filled by rolling
  // up blocks_1min_agg to hourly shape and UNIONing before the final aggregation.
  return queryOne<SummaryRow>(
    `WITH src AS (
      SELECT
        bucket,
        total_base_fee_sum,
        total_priority_fee_sum,
        gas_used_sum,
        gas_limit_sum,
        tx_count_sum,
        block_count,
        block_time_sum,
        block_start,
        block_end,
        finality_avg,
        finalized_count,
        tps_max,
        mgas_per_sec_max,
        base_fee_avg,
        median_priority_fee_avg,
        total_gas_price_avg
      FROM blocks_1hour_agg
      WHERE bucket >= $1 AND bucket < $2
      UNION ALL
      SELECT
        time_bucket('1 hour', bucket) AS bucket,
        SUM(total_base_fee_sum),
        SUM(total_priority_fee_sum),
        SUM(gas_used_sum),
        SUM(gas_limit_sum),
        SUM(tx_count_sum),
        SUM(block_count),
        SUM(block_time_sum),
        MIN(block_start),
        MAX(block_end),
        SUM(finality_avg * finalized_count) / NULLIF(SUM(finalized_count), 0),
        SUM(finalized_count),
        MAX(tps_max),
        MAX(mgas_per_sec_max),
        SUM(base_fee_avg * block_count) / NULLIF(SUM(block_count), 0),
        SUM(median_priority_fee_avg * block_count) / NULLIF(SUM(block_count), 0),
        SUM(total_gas_price_avg * block_count) / NULLIF(SUM(block_count), 0)
      FROM blocks_1min_agg
      WHERE bucket >= (
          SELECT COALESCE(MAX(bucket) + INTERVAL '1 hour', '-infinity'::timestamptz)
          FROM blocks_1hour_agg
        )
        AND bucket >= $1 AND bucket < $2
      GROUP BY 1
    )
    SELECT
      SUM(s.total_base_fee_sum) AS base_fee_gwei_sum,
      SUM(s.total_priority_fee_sum) AS priority_fee_gwei_sum,
      SUM(s.total_base_fee_sum * p.price_usd) / 1e9 AS base_fee_usd_sum,
      SUM(s.total_priority_fee_sum * p.price_usd) / 1e9 AS priority_fee_usd_sum,
      COUNT(DISTINCT s.bucket) FILTER (WHERE p.price_usd IS NULL) AS usd_missing_hours,
      SUM(s.gas_used_sum) AS gas_used_sum,
      SUM(s.gas_limit_sum) AS gas_limit_sum,
      SUM(s.tx_count_sum) AS tx_count_sum,
      SUM(s.block_count) AS block_count,
      SUM(s.block_time_sum) AS block_time_sum,
      MIN(s.block_start) AS block_start,
      MAX(s.block_end) AS block_end,
      SUM(s.finality_avg * s.finalized_count) / NULLIF(SUM(s.finalized_count), 0) AS finality_avg,
      MAX(s.tps_max) AS peak_tps,
      MAX(s.mgas_per_sec_max) AS peak_mgas,
      SUM(s.base_fee_avg * s.block_count) / NULLIF(SUM(s.block_count), 0) AS base_fee_gwei_avg,
      SUM(s.median_priority_fee_avg * s.block_count) / NULLIF(SUM(s.block_count), 0) AS median_priority_fee_gwei_avg,
      SUM(s.total_gas_price_avg * s.block_count) / NULLIF(SUM(s.block_count), 0) AS total_fee_gwei_avg,
      LEAST(
        (SELECT MAX(bucket) + INTERVAL '1 minute' FROM blocks_1min_agg WHERE bucket < $2),
        $2
      ) AS data_end
    FROM src s
    LEFT JOIN pol_prices p ON p.ts = s.bucket`,
    [fromDate, toDate]
  );
}

/**
 * Resolve the block that achieved the range's peak for a metric.
 * Aggregates store the max value but not which block produced it, so drill
 * down: peak hour (hourly source, incl. the un-materialized head) -> peak
 * minute -> raw blocks within that minute. Every step is a narrow,
 * index-friendly window, so this stays cheap even when the peak lands in a
 * compressed chunk. Best-effort: returns null when anything is missing.
 */
async function findPeakBlock(
  source: StatsSource,
  metric: 'tps' | 'mgas_per_sec',
  fromDate: Date,
  toDate: Date
): Promise<number | null> {
  const aggCol = metric === 'tps' ? 'tps_max' : 'mgas_per_sec_max';

  let minuteFrom = fromDate;
  let minuteTo = toDate;

  if (source === 'blocks_1hour_agg') {
    const hourRow = await queryOne<{ bucket: Date }>(
      `WITH src AS (
        SELECT bucket, ${aggCol} AS peak FROM blocks_1hour_agg
        WHERE bucket >= $1 AND bucket < $2
        UNION ALL
        SELECT time_bucket('1 hour', bucket), MAX(${aggCol})
        FROM blocks_1min_agg
        WHERE bucket >= (
            SELECT COALESCE(MAX(bucket) + INTERVAL '1 hour', '-infinity'::timestamptz)
            FROM blocks_1hour_agg
          )
          AND bucket >= $1 AND bucket < $2
        GROUP BY 1
      )
      SELECT bucket FROM src ORDER BY peak DESC NULLS LAST LIMIT 1`,
      [fromDate, toDate]
    );
    if (!hourRow) return null;
    minuteFrom = new Date(hourRow.bucket);
    minuteTo = new Date(minuteFrom.getTime() + 3600_000);
  }

  if (source !== 'blocks') {
    const minuteRow = await queryOne<{ bucket: Date }>(
      `SELECT bucket FROM blocks_1min_agg
       WHERE bucket >= $1 AND bucket < $2
       ORDER BY ${aggCol} DESC NULLS LAST LIMIT 1`,
      [minuteFrom, minuteTo]
    );
    if (!minuteRow) return null;
    minuteFrom = new Date(minuteRow.bucket);
    minuteTo = new Date(minuteFrom.getTime() + 60_000);
  }

  const blockRow = await queryOne<{ block_number: string }>(
    `SELECT block_number FROM blocks
     WHERE timestamp >= $1 AND timestamp < $2
     ORDER BY ${metric} DESC NULLS LAST LIMIT 1`,
    [minuteFrom, minuteTo]
  );
  const blockNumber = blockRow ? Number(blockRow.block_number) : NaN;
  return Number.isFinite(blockNumber) ? blockNumber : null;
}

/**
 * Aggregate summary stats over [fromSec, toSec] (unix seconds).
 *
 * - Clamps `to` to now and `from` to the earliest indexed data (handles ALL / from=0).
 * - Routes to raw blocks / 1min agg / 1hour agg based on range length and age.
 * - Snaps the window to the source's bucket boundaries (from floored, to ceiled)
 *   BEFORE querying, and returns the snapped range, so every metric describes
 *   the identical window.
 */
export async function getSummaryStats(fromSec: number, toSec: number): Promise<SummaryStats> {
  const nowSec = Math.floor(Date.now() / 1000);
  const to = Math.min(toSec, nowSec);
  let from = fromSec;

  // ALL range / pre-history: clamp from to the earliest data timestamp
  const earliestSec = await getEarliestBucketSec();
  if (earliestSec !== null && from < earliestSec) {
    from = earliestSec;
  }
  if (from > to) {
    from = to;
  }

  // Source routing (age-aware)
  const rangeSec = to - from;
  let source: StatsSource;
  let bucketSec: number;
  if (rangeSec <= RAW_MAX_RANGE_SEC && from >= nowSec - RAW_MAX_AGE_SEC) {
    source = 'blocks';
    bucketSec = 1; // exact seconds — no snapping
  } else if (rangeSec <= MIN_AGG_MAX_RANGE_SEC) {
    source = 'blocks_1min_agg';
    bucketSec = 60;
  } else {
    source = 'blocks_1hour_agg';
    bucketSec = 3600;
  }

  // Window snapping: expand to full bucket boundaries so the queried window
  // exactly matches the returned range
  const snappedFrom = Math.floor(from / bucketSec) * bucketSec;
  const snappedTo = Math.ceil(to / bucketSec) * bucketSec;

  const fromDate = new Date(snappedFrom * 1000);
  const toDate = new Date(snappedTo * 1000);
  const [row, latestPrice, rateRows, peakTpsBlock, peakMgasBlock] = await Promise.all([
    fetchSummaryRow(source, fromDate, toDate),
    getLatestPrice(),
    getAllInflationRates(),
    findPeakBlock(source, 'tps', fromDate, toDate).catch(() => null),
    findPeakBlock(source, 'mgas_per_sec', fromDate, toDate).catch(() => null),
  ]);

  const baseGweiSum = toNum(row?.base_fee_gwei_sum) ?? 0;
  const priorityGweiSum = toNum(row?.priority_fee_gwei_sum) ?? 0;
  const basePol = baseGweiSum / GWEI_PER_POL;
  const priorityPol = priorityGweiSum / GWEI_PER_POL;
  const totalPol = basePol + priorityPol;

  const baseUsd = toNum(row?.base_fee_usd_sum);
  const priorityUsd = toNum(row?.priority_fee_usd_sum);
  const totalUsd =
    baseUsd === null && priorityUsd === null ? null : (baseUsd ?? 0) + (priorityUsd ?? 0);

  const usdMissingHours = toNum(row?.usd_missing_hours) ?? 0;
  const gasUsedSum = toNum(row?.gas_used_sum) ?? 0;
  const gasLimitSum = toNum(row?.gas_limit_sum) ?? 0;
  const txCount = toNum(row?.tx_count_sum) ?? 0;
  const blockCount = toNum(row?.block_count) ?? 0;
  const blockTimeSum = toNum(row?.block_time_sum) ?? 0;

  // Derived metrics (null when the denominator is zero / no data)
  const avgTps = blockTimeSum > 0 ? txCount / blockTimeSum : null;
  const avgMgas = blockTimeSum > 0 ? gasUsedSum / blockTimeSum / 1e6 : null;
  const avgBlockTimeSec = blockCount > 0 && blockTimeSum > 0 ? blockTimeSum / blockCount : null;
  const utilizationPct = gasLimitSum > 0 ? (gasUsedSum / gasLimitSum) * 100 : null;
  const avgTxFeePol = txCount > 0 ? totalPol / txCount : null;
  const avgTxFeeUsd = txCount > 0 && totalUsd !== null ? totalUsd / txCount : null;

  const priceUsd = latestPrice?.priceUsd ?? null;

  // Inflation: issuance from on-chain rate params minus burn (base fees)
  let inflation: SummaryStats['inflation'] = null;
  if (rateRows.length > 0) {
    const rates = prepareRatesForCalculation(rateRows);
    // Issuance stops at now — the snapped window may extend into the future.
    // It also can't start before the first on-chain rate record (findRateAt
    // returns null there, which would zero issuance for the whole range —
    // e.g. ALL starting in 2020 vs rates starting Oct 2023).
    const firstRateStartSec = Number(rates[0].startTimestamp);
    const issuanceStartSec = Math.max(snappedFrom, firstRateStartSec);
    // Clamp issuance to the burn data actually summed: burn ends at the last
    // indexed bucket, which trails `now` by the indexing/materialization lag
    // (~1-4 min). Integrating issuance through `now` while burn stops earlier
    // biases short ranges toward inflation.
    const dataEndSec = row?.data_end
      ? Math.floor(new Date(row.data_end).getTime() / 1000)
      : nowSec;
    const issuanceEndSec = Math.min(snappedTo, nowSec, dataEndSec);
    const issuancePol = issuanceStartSec < issuanceEndSec
      ? weiToPol(calculateBucketIssuance(issuanceStartSec, issuanceEndSec, rates))
      : 0;
    const burnedPol = basePol;
    const netInflationPol = issuancePol - burnedPol;

    let netInflationPctOfSupply: number | null = null;
    let supplyAtStartPol = 0;
    const rateAtStart = findRateAt(issuanceStartSec, rates);
    if (rateAtStart) {
      supplyAtStartPol = weiToPol(calculateSupplyAt(issuanceStartSec, rateAtStart));
      if (supplyAtStartPol > 0) {
        netInflationPctOfSupply = (netInflationPol / supplyAtStartPol) * 100;
      }
    }

    // Annualized run rates. Issuance and burn each extrapolate over their own
    // covered window — they differ on ALL, where burn data (2020+) predates the
    // first inflation-rate record (Oct 2023) — then net is the difference of
    // the two per-year rates, which stays coherent across mismatched windows.
    const issuancePeriodSec = Math.max(0, issuanceEndSec - issuanceStartSec);
    const burnPeriodSec = Math.max(0, Math.min(snappedTo, nowSec, dataEndSec) - snappedFrom);
    let annualized: NonNullable<SummaryStats['inflation']>['annualized'] = null;
    if (burnPeriodSec > 0) {
      const issuancePerYear =
        issuancePeriodSec > 0 ? annualize(issuancePol, issuancePeriodSec) : 0;
      const burnedPerYear = annualize(burnedPol, burnPeriodSec);
      const netPerYear = issuancePerYear - burnedPerYear;
      const pctOfSupply = (perYear: number): number | null =>
        supplyAtStartPol > 0 ? (perYear / supplyAtStartPol) * 100 : null;
      annualized = {
        issuancePol: issuancePerYear,
        burnedPol: burnedPerYear,
        netInflationPol: netPerYear,
        netInflationUsd: priceUsd !== null ? netPerYear * priceUsd : null,
        issuancePctOfSupply: pctOfSupply(issuancePerYear),
        burnedPctOfSupply: pctOfSupply(burnedPerYear),
        netInflationPctOfSupply: pctOfSupply(netPerYear),
      };
    }

    inflation = {
      issuancePol,
      burnedPol,
      netInflationPol,
      netInflationUsd: priceUsd !== null ? netInflationPol * priceUsd : null,
      netInflationPctOfSupply,
      annualized,
    };
  }

  return {
    range: { from: snappedFrom, to: snappedTo },
    source,
    fees: {
      basePol,
      priorityPol,
      totalPol,
      baseUsd,
      priorityUsd,
      totalUsd,
      avgTxFeePol,
      avgTxFeeUsd,
      usdMissingHours,
      avgBaseFeeGwei: toNum(row?.base_fee_gwei_avg),
      avgMedianPriorityFeeGwei: toNum(row?.median_priority_fee_gwei_avg),
      avgTotalFeeGwei: toNum(row?.total_fee_gwei_avg),
    },
    throughput: {
      avgTps,
      peakTps: toNum(row?.peak_tps),
      peakTpsBlock,
      avgMgas,
      peakMgas: toNum(row?.peak_mgas),
      peakMgasBlock,
    },
    blocks: {
      count: blockCount,
      txCount,
      avgBlockTimeSec,
      gasUsedSum,
      utilizationPct,
      blockStart: toNum(row?.block_start),
      blockEnd: toNum(row?.block_end),
      avgFinalitySec: toNum(row?.finality_avg),
    },
    inflation,
    priceUsd,
  };
}
