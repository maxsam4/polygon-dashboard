-- Migration: Create indexer_state table for cursor-based tracking
-- This table stores the cursor position (last processed block/milestone) for each indexer service

CREATE TABLE IF NOT EXISTS indexer_state (
    service_name VARCHAR(50) PRIMARY KEY,
    last_block BIGINT NOT NULL,
    last_hash CHAR(66) NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add comment for documentation
COMMENT ON TABLE indexer_state IS 'Stores cursor position for each indexer service (block_indexer, milestone_indexer, block_backfiller)';
COMMENT ON COLUMN indexer_state.service_name IS 'Unique identifier for the indexer service';
COMMENT ON COLUMN indexer_state.last_block IS 'Last processed block number (or sequence_id for milestones)';
COMMENT ON COLUMN indexer_state.last_hash IS 'Hash of the last processed block (for reorg detection)';
COMMENT ON COLUMN indexer_state.updated_at IS 'Timestamp of last cursor update';
