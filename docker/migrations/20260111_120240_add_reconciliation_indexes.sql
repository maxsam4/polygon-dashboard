-- Add indexes to optimize reconciliation queries
-- These indexes prevent full table scans during finality reconciliation

-- Partial index on unfinalized blocks - used by reconcileUnfinalizedBlocks
-- This is critical for performance: without it, queries scan millions of rows
CREATE INDEX IF NOT EXISTS idx_blocks_finalized_block_number
ON blocks(finalized, block_number)
WHERE finalized = FALSE;

-- Index on milestones block range - used for BETWEEN joins
CREATE INDEX IF NOT EXISTS idx_milestones_block_range
ON milestones(start_block, end_block);
