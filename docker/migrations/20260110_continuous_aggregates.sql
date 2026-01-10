-- Continuous Aggregates for Chart Data
-- These pre-compute aggregations to dramatically speed up chart queries
-- Created: 2026-01-10

-- 1-minute continuous aggregate for fine-grained charts
CREATE MATERIALIZED VIEW IF NOT EXISTS blocks_1min_agg
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', timestamp) AS bucket,

  -- Block range
  MIN(block_number) AS block_start,
  MAX(block_number) AS block_end,
  COUNT(*) AS block_count,

  -- Base fee OHLC
  FIRST(base_fee_gwei, timestamp) AS base_fee_open,
  MAX(base_fee_gwei) AS base_fee_high,
  MIN(base_fee_gwei) AS base_fee_low,
  LAST(base_fee_gwei, timestamp) AS base_fee_close,
  AVG(base_fee_gwei) AS base_fee_avg,

  -- Priority fee stats
  AVG(avg_priority_fee_gwei) AS priority_fee_avg,
  MIN(min_priority_fee_gwei) AS priority_fee_min,
  MAX(max_priority_fee_gwei) AS priority_fee_max,
  FIRST(avg_priority_fee_gwei, timestamp) AS priority_fee_open,
  LAST(avg_priority_fee_gwei, timestamp) AS priority_fee_close,

  -- Total gas price
  AVG(base_fee_gwei + avg_priority_fee_gwei) AS total_gas_price_avg,
  MIN(base_fee_gwei + min_priority_fee_gwei) AS total_gas_price_min,
  MAX(base_fee_gwei + max_priority_fee_gwei) AS total_gas_price_max,

  -- Fee sums (for cumulative charts)
  SUM(total_base_fee_gwei) AS total_base_fee_sum,
  SUM(total_priority_fee_gwei) AS total_priority_fee_sum,

  -- Performance metrics
  SUM(gas_used) AS gas_used_sum,
  SUM(tx_count) AS tx_count_sum,
  SUM(block_time_sec) AS block_time_sum,

  -- Finality stats (only finalized blocks)
  AVG(time_to_finality_sec) FILTER (WHERE finalized) AS finality_avg,
  MIN(time_to_finality_sec) FILTER (WHERE finalized) AS finality_min,
  MAX(time_to_finality_sec) FILTER (WHERE finalized) AS finality_max,
  COUNT(*) FILTER (WHERE finalized) AS finalized_count

FROM blocks
GROUP BY bucket
WITH NO DATA;

-- 1-hour continuous aggregate for longer time ranges
CREATE MATERIALIZED VIEW IF NOT EXISTS blocks_1hour_agg
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', timestamp) AS bucket,

  -- Block range
  MIN(block_number) AS block_start,
  MAX(block_number) AS block_end,
  COUNT(*) AS block_count,

  -- Base fee OHLC
  FIRST(base_fee_gwei, timestamp) AS base_fee_open,
  MAX(base_fee_gwei) AS base_fee_high,
  MIN(base_fee_gwei) AS base_fee_low,
  LAST(base_fee_gwei, timestamp) AS base_fee_close,
  AVG(base_fee_gwei) AS base_fee_avg,

  -- Priority fee stats
  AVG(avg_priority_fee_gwei) AS priority_fee_avg,
  MIN(min_priority_fee_gwei) AS priority_fee_min,
  MAX(max_priority_fee_gwei) AS priority_fee_max,
  FIRST(avg_priority_fee_gwei, timestamp) AS priority_fee_open,
  LAST(avg_priority_fee_gwei, timestamp) AS priority_fee_close,

  -- Total gas price
  AVG(base_fee_gwei + avg_priority_fee_gwei) AS total_gas_price_avg,
  MIN(base_fee_gwei + min_priority_fee_gwei) AS total_gas_price_min,
  MAX(base_fee_gwei + max_priority_fee_gwei) AS total_gas_price_max,

  -- Fee sums
  SUM(total_base_fee_gwei) AS total_base_fee_sum,
  SUM(total_priority_fee_gwei) AS total_priority_fee_sum,

  -- Performance metrics
  SUM(gas_used) AS gas_used_sum,
  SUM(tx_count) AS tx_count_sum,
  SUM(block_time_sec) AS block_time_sum,

  -- Finality stats
  AVG(time_to_finality_sec) FILTER (WHERE finalized) AS finality_avg,
  MIN(time_to_finality_sec) FILTER (WHERE finalized) AS finality_min,
  MAX(time_to_finality_sec) FILTER (WHERE finalized) AS finality_max,
  COUNT(*) FILTER (WHERE finalized) AS finalized_count

FROM blocks
GROUP BY bucket
WITH NO DATA;

-- Refresh policies: keep aggregates up to date automatically
-- 1-minute aggregate: refresh every minute, looking back 10 minutes
SELECT add_continuous_aggregate_policy('blocks_1min_agg',
  start_offset => INTERVAL '10 minutes',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE);

-- 1-hour aggregate: refresh every 5 minutes, looking back 4 hours
-- Window must cover at least 2 buckets (2 hours minimum for 1-hour buckets)
SELECT add_continuous_aggregate_policy('blocks_1hour_agg',
  start_offset => INTERVAL '4 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => TRUE);

-- Initial refresh to populate with existing data
-- This may take a while depending on data volume
CALL refresh_continuous_aggregate('blocks_1min_agg', NULL, NOW());
CALL refresh_continuous_aggregate('blocks_1hour_agg', NULL, NOW());
