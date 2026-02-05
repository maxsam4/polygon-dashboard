-- Migration: Add block range support to anomalies table
-- Groups consecutive blocks with same anomaly into ranges

-- Add end_block_number column
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS end_block_number BIGINT;

-- Backfill: set end_block_number = block_number for existing rows
UPDATE anomalies SET end_block_number = block_number WHERE end_block_number IS NULL AND block_number IS NOT NULL;

-- Rename block_number to start_block_number for clarity
ALTER TABLE anomalies RENAME COLUMN block_number TO start_block_number;

-- Add index for finding extendable ranges (metric_type, severity, end_block_number)
CREATE INDEX IF NOT EXISTS idx_anomalies_range_lookup
ON anomalies (metric_type, severity, end_block_number);
