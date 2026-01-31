-- Migration: Populate block_finality from existing blocks data
-- One-time migration to copy finality data from blocks table to new block_finality table

INSERT INTO block_finality (block_number, milestone_id, finalized_at, time_to_finality_sec, created_at)
SELECT
    block_number::BIGINT,
    milestone_id,
    finalized_at,
    time_to_finality_sec,
    NOW()
FROM blocks
WHERE finalized = TRUE
  AND milestone_id IS NOT NULL
  AND finalized_at IS NOT NULL
ON CONFLICT (block_number) DO NOTHING;

-- Log the migration result
DO $$
DECLARE
    migrated_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO migrated_count FROM block_finality;
    RAISE NOTICE 'Migrated % blocks with finality data to block_finality table', migrated_count;
END $$;
