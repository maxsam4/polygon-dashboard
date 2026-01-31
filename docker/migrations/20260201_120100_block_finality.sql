-- Migration: Create block_finality table for finality data
-- Separates finality tracking from blocks table for cleaner architecture

CREATE TABLE IF NOT EXISTS block_finality (
    block_number BIGINT PRIMARY KEY,
    milestone_id BIGINT NOT NULL,
    finalized_at TIMESTAMPTZ NOT NULL,
    time_to_finality_sec REAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying finality by milestone
CREATE INDEX IF NOT EXISTS idx_block_finality_milestone ON block_finality (milestone_id);

-- Index for recent finality queries
CREATE INDEX IF NOT EXISTS idx_block_finality_finalized_at ON block_finality (finalized_at DESC);

-- Add comments for documentation
COMMENT ON TABLE block_finality IS 'Stores finality data for blocks, populated by milestone indexer';
COMMENT ON COLUMN block_finality.block_number IS 'Block number that was finalized';
COMMENT ON COLUMN block_finality.milestone_id IS 'Milestone ID that finalized this block';
COMMENT ON COLUMN block_finality.finalized_at IS 'Timestamp when the milestone was confirmed (finality timestamp)';
COMMENT ON COLUMN block_finality.time_to_finality_sec IS 'Seconds between block timestamp and finality (NULL if block not yet indexed)';
