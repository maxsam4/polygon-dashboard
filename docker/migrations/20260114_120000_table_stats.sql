-- Create materialized stats cache table to eliminate expensive aggregate queries
-- This table stores pre-computed MIN/MAX/COUNT values to avoid scanning compressed chunks

CREATE TABLE IF NOT EXISTS table_stats (
  table_name TEXT PRIMARY KEY,
  min_value BIGINT NOT NULL,
  max_value BIGINT NOT NULL,
  total_count BIGINT NOT NULL,
  finalized_count BIGINT,
  min_finalized BIGINT,
  max_finalized BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for queries by update time
CREATE INDEX IF NOT EXISTS idx_table_stats_updated ON table_stats (updated_at DESC);

-- Initialize with current values for blocks table
INSERT INTO table_stats (table_name, min_value, max_value, total_count, finalized_count, min_finalized, max_finalized)
SELECT
  'blocks',
  COALESCE(MIN(block_number), 0)::BIGINT,
  COALESCE(MAX(block_number), 0)::BIGINT,
  COUNT(*)::BIGINT,
  COUNT(*) FILTER (WHERE finalized = true)::BIGINT,
  MIN(block_number) FILTER (WHERE finalized = true)::BIGINT,
  MAX(block_number) FILTER (WHERE finalized = true)::BIGINT
FROM blocks
ON CONFLICT (table_name) DO NOTHING;

-- Initialize with current values for milestones table
INSERT INTO table_stats (table_name, min_value, max_value, total_count)
SELECT
  'milestones',
  COALESCE(MIN(sequence_id), 0)::BIGINT,
  COALESCE(MAX(sequence_id), 0)::BIGINT,
  COUNT(*)::BIGINT
FROM milestones
ON CONFLICT (table_name) DO NOTHING;

-- Add comment to explain purpose
COMMENT ON TABLE table_stats IS 'Materialized cache of table statistics to avoid expensive MIN/MAX/COUNT queries on compressed TimescaleDB chunks';
