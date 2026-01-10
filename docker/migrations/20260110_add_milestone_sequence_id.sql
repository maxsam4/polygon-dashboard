-- Add sequence_id column to milestones table
-- The sequence_id is the actual Heimdall milestone sequence number (1, 2, 3, ...)
-- This is different from milestone_id which stores the end_block number

ALTER TABLE milestones ADD COLUMN IF NOT EXISTS sequence_id INTEGER;

-- Create index on sequence_id
CREATE INDEX IF NOT EXISTS idx_milestones_sequence ON milestones (sequence_id DESC);

-- Make sequence_id NOT NULL (only run after data is populated)
-- ALTER TABLE milestones ALTER COLUMN sequence_id SET NOT NULL;

-- Add unique constraint (only run after data is populated)
-- ALTER TABLE milestones ADD CONSTRAINT milestones_sequence_id_key UNIQUE (sequence_id);

-- NOTE: If migrating from old data where sequence_id was incorrectly set to milestone_id (block numbers),
-- you need to truncate milestones and reset block finality:
--
-- TRUNCATE TABLE milestones;
-- UPDATE blocks SET finalized = FALSE, finalized_at = NULL, milestone_id = NULL, time_to_finality_sec = NULL;
--
-- Then restart the app to let backfillers repopulate with correct sequence IDs.
