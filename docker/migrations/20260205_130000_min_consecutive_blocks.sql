-- Migration: Add min_consecutive_blocks column to metric_thresholds
-- This allows filtering alerts to only show anomalies that persist for N+ consecutive blocks

-- Add min_consecutive_blocks column with default of 1 (show all alerts)
ALTER TABLE metric_thresholds
ADD COLUMN IF NOT EXISTS min_consecutive_blocks INTEGER DEFAULT 1;

-- Set gas_price default to 2 blocks (transient spikes are common)
UPDATE metric_thresholds SET min_consecutive_blocks = 2
WHERE metric_type = 'gas_price' AND min_consecutive_blocks = 1;
