-- Add acknowledgement columns to anomalies table
-- Allows users to acknowledge alerts so they don't appear in nav badge count

ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS acknowledged BOOLEAN DEFAULT FALSE;
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

-- Index for efficient filtering on acknowledged status
CREATE INDEX IF NOT EXISTS idx_anomalies_acknowledged ON anomalies(acknowledged);

-- Composite index for badge count queries (timestamp + acknowledged)
CREATE INDEX IF NOT EXISTS idx_anomalies_timestamp_acknowledged ON anomalies(timestamp, acknowledged);
