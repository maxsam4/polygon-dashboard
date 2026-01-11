# Gap Analysis System Design

**Date:** 2026-01-11
**Status:** Approved

## Overview

Add a gap analysis system to detect and fill gaps in block and milestone data. Gaps can occur due to outages, network issues, or intentional skips by pollers.

## Goals

1. Efficiently detect gaps without re-scanning validated data
2. Store gaps in DB for fast status page queries
3. Split backfiller into backfiller (downward) + gapfiller (fills known gaps)
4. Pollers insert gaps immediately when they skip
5. Status page reads from DB tables (no computed gaps)

## Database Schema

### New `gaps` Table

```sql
CREATE TABLE gaps (
    id SERIAL PRIMARY KEY,
    gap_type VARCHAR(20) NOT NULL,        -- 'block' or 'milestone'
    start_value BIGINT NOT NULL,          -- start block_number or sequence_id
    end_value BIGINT NOT NULL,            -- end block_number or sequence_id
    gap_size INTEGER GENERATED ALWAYS AS (end_value - start_value + 1) STORED,
    source VARCHAR(50) NOT NULL,          -- 'analyzer', 'live_poller', 'milestone_poller'
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'filling', 'filled'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    filled_at TIMESTAMPTZ,
    UNIQUE(gap_type, start_value, end_value)
);

CREATE INDEX idx_gaps_pending ON gaps(gap_type, status, end_value DESC)
    WHERE status = 'pending';
```

### New `data_coverage` Table

```sql
CREATE TABLE data_coverage (
    id VARCHAR(50) PRIMARY KEY,           -- 'blocks' or 'milestones'
    low_water_mark BIGINT NOT NULL,       -- validated down to here
    high_water_mark BIGINT NOT NULL,      -- validated up to here
    last_analyzed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Workers

### GapAnalyzer (New)

**Purpose:** Scan for gaps in validated ranges and update coverage marks.

**Interval:** Every 5 minutes (immediate on first run)

**Behavior:**

1. Load current `data_coverage` for blocks and milestones
2. Get current DB boundaries (min/max block, min/max sequence_id)
3. For blocks:
   - Scan UP: from `high_water_mark` to `(max_block - 100)`
   - Scan DOWN: from `(min_block + 100)` to `low_water_mark`
   - Find missing block_numbers using `generate_series + LEFT JOIN`
   - Group consecutive missing blocks into gap ranges
   - Insert new gaps (ON CONFLICT DO NOTHING)
   - Update water marks to new validated boundaries
4. For milestones: same logic using `sequence_id`

**Batch size:** 10,000 per direction per run (prevents long queries)

**Gap detection query:**

```sql
WITH expected AS (
    SELECT generate_series($start, $end) AS val
),
actual AS (
    SELECT block_number AS val FROM blocks
    WHERE block_number BETWEEN $start AND $end
)
SELECT e.val FROM expected e
LEFT JOIN actual a ON e.val = a.val
WHERE a.val IS NULL;
```

### Gapfiller (New)

**Purpose:** Fill gaps from the gaps table.

**Interval:** Continuous with `RPC_DELAY_MS` between batches

**Behavior:**

1. Query oldest pending gap (`status='pending'`, `ORDER BY end_value DESC` for recent-first)
2. Mark gap as `'filling'`
3. Fetch blocks/milestones for that range
4. On success: mark as `'filled'`, set `filled_at`
5. On partial success: shrink gap range, keep as `'pending'`
6. Repeat

**Gap types:**
- `gap_type='block'`: use block fetching logic
- `gap_type='milestone'`: use milestone fetching logic

### Backfiller (Modified)

**Purpose:** Fill historical blocks going DOWN toward target block (unchanged)

**Changes:** No longer handles gaps - only extends downward. Gapfiller handles all gaps.

### LivePoller (Modified)

**Current:** When gap > 30 blocks, skips to `(latestBlock - 30)`

**New:** Also inserts gap record:

```sql
INSERT INTO gaps (gap_type, start_value, end_value, source)
VALUES ('block', lastProcessedBlock + 1, latestBlock - 31, 'live_poller')
ON CONFLICT DO NOTHING;
```

### MilestonePoller (Modified)

**Current:** When gap > 60 milestones, skips to `(count - 60)`

**New:** Also inserts gap record:

```sql
INSERT INTO gaps (gap_type, start_value, end_value, source)
VALUES ('milestone', lastSequenceId + 1, count - 61, 'milestone_poller')
ON CONFLICT DO NOTHING;
```

## Status Page

### API Response Changes

```typescript
{
  // Existing fields (unchanged)
  blocks: { min, max, count, finalized, unfinalized, ... },
  milestones: { minSequence, maxSequence, count, ... },

  // NEW: Coverage from data_coverage table
  coverage: {
    blocks: {
      lowWaterMark: number,
      highWaterMark: number,
      lastAnalyzedAt: string
    },
    milestones: {
      lowWaterMark: number,
      highWaterMark: number,
      lastAnalyzedAt: string
    }
  },

  // NEW: Gaps from gaps table
  gaps: {
    blocks: {
      pending: Array<{start, end, size, source, createdAt}>,
      pendingCount: number,
      totalPendingSize: number
    },
    milestones: {
      pending: Array<{start, end, size, source, createdAt}>,
      pendingCount: number,
      totalPendingSize: number
    }
  }
}
```

### Query Changes

Replace window function gap detection with simple SELECT:

```sql
SELECT * FROM gaps
WHERE gap_type = 'block' AND status = 'pending'
ORDER BY end_value DESC LIMIT 20;

SELECT * FROM data_coverage WHERE id = 'blocks';
```

### UI Updates

- Show validated ranges: "Blocks validated: 50,000,000 → 65,234,567"
- Show pending gaps with source (analyzer/poller)
- Show "Last analyzed: X minutes ago"
- Remove computed gap logic

## Worker Startup Order

1. LivePoller + MilestonePoller (start immediately)
2. GapAnalyzer (runs once immediately to initialize coverage)
3. Backfiller + MilestoneBackfiller (continuous)
4. Gapfiller (continuous)
5. FinalityReconciler (every 10s)

## Initialization

When `data_coverage` table is empty, GapAnalyzer initializes on first run:
- blocks: `low_water_mark = min(block_number)`, `high_water_mark = min(block_number)`
- milestones: `low_water_mark = min(sequence_id)`, `high_water_mark = min(sequence_id)`

## Gap Prioritization

Gaps filled in **recent-first** order (`ORDER BY end_value DESC`) since real-time accuracy matters more for a dashboard.

## Files to Create/Modify

### New Files
- `docker/migrations/20260111_gap_analysis_tables.sql`
- `src/lib/workers/gapAnalyzer.ts`
- `src/lib/workers/gapfiller.ts`
- `src/lib/queries/gaps.ts`

### Modified Files
- `src/lib/workers/index.ts` - add new workers
- `src/lib/workers/livePoller.ts` - insert gaps on skip
- `src/lib/workers/milestonePoller.ts` - insert gaps on skip
- `src/app/api/status/route.ts` - read from tables
- `src/app/status/page.tsx` - display new data structure
