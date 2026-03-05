-- Migration: Create eip1559_params table for storing BaseFeeChangeDenominator history
-- These change across hardforks and can be admin-configured post-Lisovo

CREATE TABLE IF NOT EXISTS eip1559_params (
  id SERIAL PRIMARY KEY,
  block_number BIGINT NOT NULL UNIQUE,
  base_fee_change_denominator INTEGER NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eip1559_params_block ON eip1559_params(block_number);
