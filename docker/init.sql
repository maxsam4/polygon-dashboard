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

SELECT create_hypertable('blocks', 'timestamp', chunk_time_interval => INTERVAL '7 days');

CREATE INDEX idx_blocks_number ON blocks (block_number DESC);
CREATE INDEX idx_blocks_pending ON blocks (block_number) WHERE finalized = FALSE;
CREATE INDEX idx_blocks_hash ON blocks (block_hash);

ALTER TABLE blocks SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'timestamp DESC, block_number DESC'
);
SELECT add_compression_policy('blocks', INTERVAL '7 days');

-- Milestones table
CREATE TABLE milestones (
  milestone_id BIGINT PRIMARY KEY,
  start_block BIGINT NOT NULL,
  end_block BIGINT NOT NULL,
  hash CHAR(66) NOT NULL,
  proposer CHAR(42),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_milestones_blocks ON milestones (start_block, end_block);
CREATE INDEX idx_milestones_end ON milestones (end_block DESC);
