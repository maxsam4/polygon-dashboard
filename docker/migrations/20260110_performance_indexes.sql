-- Performance optimization indexes
-- Created: 2026-01-10

-- Optimize finality reconciliation JOIN - speeds up matching unfinalized blocks to milestones
CREATE INDEX IF NOT EXISTS idx_blocks_unfin_range
ON blocks (block_number)
WHERE finalized = FALSE;

-- Speed up milestone stats calculation - for queries that aggregate finality times by milestone
CREATE INDEX IF NOT EXISTS idx_blocks_milestone_finality
ON blocks (milestone_id, time_to_finality_sec)
WHERE finalized = TRUE;

-- Optimize chart queries by timestamp range with common aggregation columns
CREATE INDEX IF NOT EXISTS idx_blocks_timestamp_metrics
ON blocks (timestamp DESC)
INCLUDE (base_fee_gwei, avg_priority_fee_gwei, total_base_fee_gwei, total_priority_fee_gwei, gas_used, tx_count, block_time_sec, time_to_finality_sec, finalized);
