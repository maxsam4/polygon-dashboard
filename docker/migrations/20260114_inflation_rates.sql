-- Migration: Create inflation_rates table for storing POL inflation rate changes
-- These are triggered by proxy upgrades on the POL emission manager contract

CREATE TABLE IF NOT EXISTS inflation_rates (
  id SERIAL PRIMARY KEY,
  block_number BIGINT NOT NULL UNIQUE,
  block_timestamp TIMESTAMPTZ NOT NULL,
  interest_per_year_log2 NUMERIC(78, 0) NOT NULL,
  start_supply NUMERIC(78, 0) NOT NULL,
  start_timestamp BIGINT NOT NULL,
  implementation_address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inflation_rates_timestamp
  ON inflation_rates(block_timestamp);

CREATE INDEX IF NOT EXISTS idx_inflation_rates_block
  ON inflation_rates(block_number);
