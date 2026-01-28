-- Drop unused indexes to save disk space
-- These indexes were found to have 0 scans in production

-- idx_blocks_hash: Never used, 5.2GB wasted
DROP INDEX IF EXISTS idx_blocks_hash;

-- idx_milestones_blocks: Duplicate of idx_milestones_block_range, 251MB wasted
DROP INDEX IF EXISTS idx_milestones_blocks;

-- idx_milestones_timestamp: Never used, 149MB wasted
DROP INDEX IF EXISTS idx_milestones_timestamp;

-- idx_milestones_created_at: Never used, 58MB wasted
DROP INDEX IF EXISTS idx_milestones_created_at;
