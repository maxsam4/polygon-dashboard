-- Add index on milestones.timestamp for efficient time-range queries
-- Used by the milestone chart data endpoint for block time calculations
CREATE INDEX IF NOT EXISTS idx_milestones_timestamp ON milestones (timestamp DESC);
