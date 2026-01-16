-- Add index on created_at for efficient queries filtering recent milestones
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_milestones_created_at
ON milestones (created_at DESC);
