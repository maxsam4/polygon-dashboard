-- Migration: Add sequence_id to milestones table
-- This requires clearing existing milestones as we don't have their sequence IDs

-- Drop existing milestones (they'll be re-fetched with correct sequence_ids)
TRUNCATE TABLE milestones CASCADE;

-- Reset finality data on blocks (will be re-reconciled)
UPDATE blocks SET
  finalized = FALSE,
  finalized_at = NULL,
  milestone_id = NULL,
  time_to_finality_sec = NULL
WHERE finalized = TRUE;

-- Add sequence_id column
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS sequence_id INTEGER;

-- Make it NOT NULL and UNIQUE (after truncate, this is safe)
ALTER TABLE milestones ALTER COLUMN sequence_id SET NOT NULL;
ALTER TABLE milestones ADD CONSTRAINT milestones_sequence_id_unique UNIQUE (sequence_id);

-- Add index for sequence_id lookups
CREATE INDEX IF NOT EXISTS idx_milestones_sequence ON milestones (sequence_id DESC);
