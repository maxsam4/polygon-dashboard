-- Migration: Gap Analysis Tables
-- Description: Creates gaps and data_coverage tables for gap detection and tracking
-- Date: 2026-01-11

-- ============================================================================
-- GAPS TABLE
-- Tracks detected gaps in blocks, milestones, and finality data
-- ============================================================================

CREATE TABLE IF NOT EXISTS gaps (
    id SERIAL PRIMARY KEY,
    gap_type VARCHAR(20) NOT NULL,  -- 'block', 'milestone', or 'finality'
    start_value BIGINT NOT NULL,
    end_value BIGINT NOT NULL,
    gap_size INTEGER GENERATED ALWAYS AS (end_value - start_value + 1) STORED,
    source VARCHAR(50) NOT NULL,  -- 'analyzer', 'live_poller', 'milestone_poller'
    status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'filling', 'filled'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    filled_at TIMESTAMPTZ,
    CONSTRAINT gaps_type_range_unique UNIQUE (gap_type, start_value, end_value),
    CONSTRAINT gaps_valid_range CHECK (end_value >= start_value),
    CONSTRAINT gaps_valid_type CHECK (gap_type IN ('block', 'milestone', 'finality')),
    CONSTRAINT gaps_valid_status CHECK (status IN ('pending', 'filling', 'filled'))
);

-- Index for gapfiller queries: find pending gaps ordered by end_value DESC
-- Partial index on status = 'pending' for efficient gap filling
CREATE INDEX IF NOT EXISTS idx_gaps_pending
    ON gaps (gap_type, status, end_value DESC)
    WHERE status = 'pending';

-- Index for status queries and monitoring
CREATE INDEX IF NOT EXISTS idx_gaps_status
    ON gaps (gap_type, status);

-- ============================================================================
-- DATA_COVERAGE TABLE
-- Tracks overall coverage watermarks for blocks and milestones
-- ============================================================================

CREATE TABLE IF NOT EXISTS data_coverage (
    id VARCHAR(50) PRIMARY KEY,  -- 'blocks' or 'milestones'
    low_water_mark BIGINT NOT NULL,
    high_water_mark BIGINT NOT NULL,
    last_analyzed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT data_coverage_valid_range CHECK (high_water_mark >= low_water_mark)
);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE gaps IS 'Tracks detected gaps in blockchain data (blocks, milestones, finality)';
COMMENT ON COLUMN gaps.gap_type IS 'Type of gap: block, milestone, or finality';
COMMENT ON COLUMN gaps.start_value IS 'Start of gap range (inclusive) - block_number or milestone_id';
COMMENT ON COLUMN gaps.end_value IS 'End of gap range (inclusive) - block_number or milestone_id';
COMMENT ON COLUMN gaps.gap_size IS 'Number of missing items in this gap (computed)';
COMMENT ON COLUMN gaps.source IS 'What detected this gap: analyzer, live_poller, milestone_poller';
COMMENT ON COLUMN gaps.status IS 'Gap status: pending (needs filling), filling (in progress), filled (complete)';
COMMENT ON COLUMN gaps.filled_at IS 'Timestamp when gap was completely filled';

COMMENT ON TABLE data_coverage IS 'Tracks overall data coverage watermarks';
COMMENT ON COLUMN data_coverage.id IS 'Coverage type: blocks or milestones';
COMMENT ON COLUMN data_coverage.low_water_mark IS 'Lowest contiguous value from start of range';
COMMENT ON COLUMN data_coverage.high_water_mark IS 'Highest value seen';
COMMENT ON COLUMN data_coverage.last_analyzed_at IS 'When gap analysis was last run';
