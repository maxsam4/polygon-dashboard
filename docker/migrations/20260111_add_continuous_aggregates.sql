-- Migration: Add continuous aggregates for chart data
-- These are required by the chart-data API endpoint

-- 1-minute aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS blocks_1min_agg
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', timestamp) AS bucket,
  MIN(block_number) AS block_start,
  MAX(block_number) AS block_end,
  COUNT(*) AS block_count,
  first(base_fee_gwei, timestamp) AS base_fee_open,
  MAX(base_fee_gwei) AS base_fee_high,
  MIN(base_fee_gwei) AS base_fee_low,
  last(base_fee_gwei, timestamp) AS base_fee_close,
  AVG(base_fee_gwei) AS base_fee_avg,
  AVG(avg_priority_fee_gwei) AS priority_fee_avg,
  MIN(min_priority_fee_gwei) AS priority_fee_min,
  MAX(max_priority_fee_gwei) AS priority_fee_max,
  first(avg_priority_fee_gwei, timestamp) AS priority_fee_open,
  last(avg_priority_fee_gwei, timestamp) AS priority_fee_close,
  AVG(base_fee_gwei + avg_priority_fee_gwei) AS total_gas_price_avg,
  MIN(base_fee_gwei + min_priority_fee_gwei) AS total_gas_price_min,
  MAX(base_fee_gwei + max_priority_fee_gwei) AS total_gas_price_max,
  SUM(total_base_fee_gwei) AS total_base_fee_sum,
  SUM(total_priority_fee_gwei) AS total_priority_fee_sum,
  SUM(gas_used) AS gas_used_sum,
  SUM(tx_count) AS tx_count_sum,
  SUM(block_time_sec) AS block_time_sum,
  AVG(time_to_finality_sec) FILTER (WHERE finalized) AS finality_avg,
  MIN(time_to_finality_sec) FILTER (WHERE finalized) AS finality_min,
  MAX(time_to_finality_sec) FILTER (WHERE finalized) AS finality_max,
  COUNT(*) FILTER (WHERE finalized) AS finalized_count
FROM blocks
GROUP BY bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('blocks_1min_agg',
  start_offset => INTERVAL '1 hour',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE);

-- 1-hour aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS blocks_1hour_agg
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', timestamp) AS bucket,
  MIN(block_number) AS block_start,
  MAX(block_number) AS block_end,
  COUNT(*) AS block_count,
  first(base_fee_gwei, timestamp) AS base_fee_open,
  MAX(base_fee_gwei) AS base_fee_high,
  MIN(base_fee_gwei) AS base_fee_low,
  last(base_fee_gwei, timestamp) AS base_fee_close,
  AVG(base_fee_gwei) AS base_fee_avg,
  AVG(avg_priority_fee_gwei) AS priority_fee_avg,
  MIN(min_priority_fee_gwei) AS priority_fee_min,
  MAX(max_priority_fee_gwei) AS priority_fee_max,
  first(avg_priority_fee_gwei, timestamp) AS priority_fee_open,
  last(avg_priority_fee_gwei, timestamp) AS priority_fee_close,
  AVG(base_fee_gwei + avg_priority_fee_gwei) AS total_gas_price_avg,
  MIN(base_fee_gwei + min_priority_fee_gwei) AS total_gas_price_min,
  MAX(base_fee_gwei + max_priority_fee_gwei) AS total_gas_price_max,
  SUM(total_base_fee_gwei) AS total_base_fee_sum,
  SUM(total_priority_fee_gwei) AS total_priority_fee_sum,
  SUM(gas_used) AS gas_used_sum,
  SUM(tx_count) AS tx_count_sum,
  SUM(block_time_sec) AS block_time_sum,
  AVG(time_to_finality_sec) FILTER (WHERE finalized) AS finality_avg,
  MIN(time_to_finality_sec) FILTER (WHERE finalized) AS finality_min,
  MAX(time_to_finality_sec) FILTER (WHERE finalized) AS finality_max,
  COUNT(*) FILTER (WHERE finalized) AS finalized_count
FROM blocks
GROUP BY bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('blocks_1hour_agg',
  start_offset => INTERVAL '1 day',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE);

-- Refresh aggregates with existing data
CALL refresh_continuous_aggregate('blocks_1min_agg', NULL, NULL);
CALL refresh_continuous_aggregate('blocks_1hour_agg', NULL, NULL);
