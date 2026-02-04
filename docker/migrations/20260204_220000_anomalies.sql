-- Migration: Anomaly detection tables
-- Creates tables for storing detected anomalies and threshold configuration

-- Anomalies table - stores detected anomalies
CREATE TABLE IF NOT EXISTS anomalies (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metric_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
  value DOUBLE PRECISION,
  expected_value DOUBLE PRECISION,
  threshold DOUBLE PRECISION,
  block_number BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_anomalies_timestamp ON anomalies(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_anomalies_metric ON anomalies(metric_type);
CREATE INDEX IF NOT EXISTS idx_anomalies_severity ON anomalies(severity);
CREATE INDEX IF NOT EXISTS idx_anomalies_metric_timestamp ON anomalies(metric_type, timestamp DESC);

-- Metric thresholds configuration table
CREATE TABLE IF NOT EXISTS metric_thresholds (
  metric_type TEXT PRIMARY KEY,
  warning_low DOUBLE PRECISION,
  warning_high DOUBLE PRECISION,
  critical_low DOUBLE PRECISION,
  critical_high DOUBLE PRECISION,
  use_absolute BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert calibrated defaults
-- These thresholds are configurable via admin panel at /admin
INSERT INTO metric_thresholds (metric_type, warning_low, warning_high, critical_low, critical_high, use_absolute) VALUES
  ('gas_price', 10, 2000, 2, 5000, FALSE),           -- Gas price in Gwei
  ('block_time', NULL, 3, 1, 5, TRUE),               -- Block time in seconds
  ('finality', NULL, 10, NULL, 30, FALSE),           -- Finality in seconds
  ('tps', 5, 2000, NULL, 3000, FALSE),               -- Transactions per second
  ('mgas', 2, NULL, NULL, NULL, FALSE)               -- MGAS/s (only low warning)
ON CONFLICT (metric_type) DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE anomalies IS 'Stores detected anomalies for key metrics (gas, finality, TPS, MGAS/s, block time, reorgs)';
COMMENT ON COLUMN anomalies.metric_type IS 'Type of metric: gas_price, block_time, finality, tps, mgas, reorg';
COMMENT ON COLUMN anomalies.severity IS 'Severity level: warning or critical';
COMMENT ON COLUMN anomalies.value IS 'Actual observed value that triggered the anomaly';
COMMENT ON COLUMN anomalies.expected_value IS 'Expected normal value (e.g., mean)';
COMMENT ON COLUMN anomalies.threshold IS 'Threshold that was exceeded';
COMMENT ON COLUMN anomalies.block_number IS 'Block number associated with this anomaly (if applicable)';

COMMENT ON TABLE metric_thresholds IS 'Configuration for anomaly detection thresholds';
COMMENT ON COLUMN metric_thresholds.warning_low IS 'Lower bound for warning level (NULL = no lower bound)';
COMMENT ON COLUMN metric_thresholds.warning_high IS 'Upper bound for warning level (NULL = no upper bound)';
COMMENT ON COLUMN metric_thresholds.critical_low IS 'Lower bound for critical level (NULL = no lower bound)';
COMMENT ON COLUMN metric_thresholds.critical_high IS 'Upper bound for critical level (NULL = no upper bound)';
COMMENT ON COLUMN metric_thresholds.use_absolute IS 'If true, use absolute thresholds; if false, use statistical methods';
