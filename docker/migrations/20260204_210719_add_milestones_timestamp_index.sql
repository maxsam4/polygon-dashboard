-- Add timestamp index to milestones table for faster time-range queries
-- The milestone-chart-data API was doing sequential scans on 1.3M+ rows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_milestones_timestamp ON milestones (timestamp);
