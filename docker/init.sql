-- docker/init.sql
-- Enable TimescaleDB
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Blocks table
CREATE TABLE blocks (
  timestamp TIMESTAMPTZ NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash CHAR(66) NOT NULL,
  parent_hash CHAR(66) NOT NULL,
  gas_used BIGINT NOT NULL,
  gas_limit BIGINT NOT NULL,
  base_fee_gwei DOUBLE PRECISION NOT NULL,
  min_priority_fee_gwei DOUBLE PRECISION NOT NULL,
  max_priority_fee_gwei DOUBLE PRECISION NOT NULL,
  avg_priority_fee_gwei DOUBLE PRECISION NOT NULL,
  median_priority_fee_gwei DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_base_fee_gwei DOUBLE PRECISION NOT NULL,
  total_priority_fee_gwei DOUBLE PRECISION NOT NULL,
  tx_count INTEGER NOT NULL,
  block_time_sec REAL,
  mgas_per_sec REAL,
  tps REAL,
  finalized BOOLEAN NOT NULL DEFAULT FALSE,
  finalized_at TIMESTAMPTZ,
  milestone_id BIGINT,
  time_to_finality_sec REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (timestamp, block_number)
);

SELECT create_hypertable('blocks', 'timestamp', chunk_time_interval => INTERVAL '24 hours');

CREATE INDEX idx_blocks_number ON blocks (block_number DESC);
CREATE INDEX idx_blocks_pending ON blocks (block_number) WHERE finalized = FALSE;

ALTER TABLE blocks SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'timestamp DESC, block_number DESC'
);
SELECT add_compression_policy('blocks', INTERVAL '7 days');

-- Milestones table
CREATE TABLE milestones (
  milestone_id BIGINT PRIMARY KEY,
  sequence_id INTEGER NOT NULL UNIQUE,
  start_block BIGINT NOT NULL,
  end_block BIGINT NOT NULL,
  hash CHAR(66) NOT NULL,
  proposer CHAR(42),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_milestones_end ON milestones (end_block DESC);
CREATE INDEX idx_milestones_sequence ON milestones (sequence_id DESC);

-- Continuous aggregates for chart data
-- 1-minute aggregate
CREATE MATERIALIZED VIEW blocks_1min_agg
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
  schedule_interval => INTERVAL '1 minute');

-- 1-hour aggregate
CREATE MATERIALIZED VIEW blocks_1hour_agg
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
  schedule_interval => INTERVAL '1 hour');
