-- Fix table_stats nullability bug
-- The min_value/max_value columns should be NULL when no data exists,
-- not 0, which causes the backfiller to think it's already complete.

-- Allow NULL for min/max when no data exists
ALTER TABLE table_stats ALTER COLUMN min_value DROP NOT NULL;
ALTER TABLE table_stats ALTER COLUMN max_value DROP NOT NULL;

-- Fix current invalid stats by recalculating from actual data
-- This will set min_value/max_value to NULL if tables are empty,
-- or to actual values if data exists
UPDATE table_stats SET
  min_value = (SELECT MIN(block_number) FROM blocks),
  max_value = (SELECT MAX(block_number) FROM blocks),
  total_count = (SELECT COUNT(*) FROM blocks)
WHERE table_name = 'blocks';

UPDATE table_stats SET
  min_value = (SELECT MIN(sequence_id) FROM milestones),
  max_value = (SELECT MAX(sequence_id) FROM milestones),
  total_count = (SELECT COUNT(*) FROM milestones)
WHERE table_name = 'milestones';

-- Reset backfiller state so it re-initializes from correct lowest block
DELETE FROM indexer_state WHERE service_name = 'block_backfiller';
