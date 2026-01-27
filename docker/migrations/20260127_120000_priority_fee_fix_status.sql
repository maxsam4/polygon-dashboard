-- Migration: Create priority_fee_fix_status table to track historical data fix progress
-- This table tracks the progress of fixing priority fee calculations for historical blocks

CREATE TABLE IF NOT EXISTS priority_fee_fix_status (
  id INTEGER PRIMARY KEY DEFAULT 1,
  fix_deployed_at_block BIGINT NOT NULL,
  last_fixed_block BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Insert placeholder row that will be updated when the fixer worker starts
-- The fix_deployed_at_block will be set to the current latest block when the worker first runs
INSERT INTO priority_fee_fix_status (id, fix_deployed_at_block)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;
