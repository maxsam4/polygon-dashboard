-- Migration: Create reorged_blocks table for tracking chain reorganizations
-- Stores blocks that were replaced during reorgs for auditing and debugging

CREATE TABLE IF NOT EXISTS reorged_blocks (
    id SERIAL PRIMARY KEY,
    block_number BIGINT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    block_hash CHAR(66) NOT NULL,
    parent_hash CHAR(66) NOT NULL,
    gas_used BIGINT NOT NULL,
    gas_limit BIGINT NOT NULL,
    base_fee_gwei DOUBLE PRECISION NOT NULL,
    tx_count INTEGER NOT NULL,
    reorged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason VARCHAR(100),
    replaced_by_hash CHAR(66)
);

-- Index for querying by block number (to find all reorgs at a given height)
CREATE INDEX IF NOT EXISTS idx_reorged_blocks_number ON reorged_blocks (block_number);

-- Index for recent reorgs (for monitoring dashboard)
CREATE INDEX IF NOT EXISTS idx_reorged_blocks_reorged_at ON reorged_blocks (reorged_at DESC);

-- Add comments for documentation
COMMENT ON TABLE reorged_blocks IS 'Archive of blocks replaced during chain reorganizations';
COMMENT ON COLUMN reorged_blocks.block_number IS 'Block height where reorg occurred';
COMMENT ON COLUMN reorged_blocks.block_hash IS 'Hash of the original (now orphaned) block';
COMMENT ON COLUMN reorged_blocks.reason IS 'Description of why the reorg happened';
COMMENT ON COLUMN reorged_blocks.replaced_by_hash IS 'Hash of the new canonical block at this height';
