# Gap Analysis System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add efficient gap detection, storage, and filling for blocks and milestones with optimized status page queries.

**Architecture:** GapAnalyzer detects data gaps AND finality gaps (blocks without finality data), updates water marks every 5 minutes. Gapfiller continuously fills gaps from DB and reconciles finality. FinalityReconciler only handles fresh data near the tip. Pollers insert gaps when skipping. Status page reads from tables instead of computing.

**Tech Stack:** PostgreSQL, TypeScript, Next.js

**Key Design Changes:**
- Gap types: `block`, `milestone`, `finality` (blocks missing finality data within milestone range)
- Gapfiller reconciles blocks after filling gaps (adds finality data for gap regions)
- FinalityReconciler handles fresh data at BOTH edges: tip (from LivePoller) + bottom (from Backfiller)
- GapAnalyzer detects finality gaps (unfinalized blocks within milestone coverage)

---

## Task 1: Database Migration

**Files:**
- Create: `docker/migrations/20260111_gap_analysis_tables.sql`

**Step 1: Create migration file**

```sql
-- Gap analysis tables migration
-- Safe to run multiple times (idempotent)

-- Gaps table: stores all detected gaps
CREATE TABLE IF NOT EXISTS gaps (
    id SERIAL PRIMARY KEY,
    gap_type VARCHAR(20) NOT NULL,
    start_value BIGINT NOT NULL,
    end_value BIGINT NOT NULL,
    gap_size INTEGER GENERATED ALWAYS AS (end_value - start_value + 1) STORED,
    source VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    filled_at TIMESTAMPTZ,
    UNIQUE(gap_type, start_value, end_value)
);

-- Index for gapfiller: recent first, pending only
CREATE INDEX IF NOT EXISTS idx_gaps_pending
ON gaps(gap_type, status, end_value DESC)
WHERE status = 'pending';

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_gaps_status ON gaps(gap_type, status);

-- Data coverage table: tracks validated ranges
CREATE TABLE IF NOT EXISTS data_coverage (
    id VARCHAR(50) PRIMARY KEY,
    low_water_mark BIGINT NOT NULL,
    high_water_mark BIGINT NOT NULL,
    last_analyzed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Step 2: Apply migration to running docker instance**

Run: `docker compose exec -T db psql -U polygon -d polygon_dashboard < docker/migrations/20260111_gap_analysis_tables.sql`
Expected: Tables created without errors

**Step 3: Commit**

```bash
git add docker/migrations/20260111_gap_analysis_tables.sql
git commit -m "feat: add gaps and data_coverage tables migration"
```

---

## Task 2: Gaps Query Module

**Files:**
- Create: `src/lib/queries/gaps.ts`

**Step 1: Create gaps query module**

```typescript
import { query, queryOne } from '@/lib/db';

export interface Gap {
  id: number;
  gapType: 'block' | 'milestone';
  startValue: bigint;
  endValue: bigint;
  gapSize: number;
  source: string;
  status: 'pending' | 'filling' | 'filled';
  createdAt: Date;
  filledAt: Date | null;
}

export interface DataCoverage {
  id: string;
  lowWaterMark: bigint;
  highWaterMark: bigint;
  lastAnalyzedAt: Date | null;
  updatedAt: Date;
}

interface GapRow {
  id: number;
  gap_type: string;
  start_value: string;
  end_value: string;
  gap_size: number;
  source: string;
  status: string;
  created_at: Date;
  filled_at: Date | null;
}

interface CoverageRow {
  id: string;
  low_water_mark: string;
  high_water_mark: string;
  last_analyzed_at: Date | null;
  updated_at: Date;
}

function rowToGap(row: GapRow): Gap {
  return {
    id: row.id,
    gapType: row.gap_type as 'block' | 'milestone',
    startValue: BigInt(row.start_value),
    endValue: BigInt(row.end_value),
    gapSize: row.gap_size,
    source: row.source,
    status: row.status as 'pending' | 'filling' | 'filled',
    createdAt: row.created_at,
    filledAt: row.filled_at,
  };
}

function rowToCoverage(row: CoverageRow): DataCoverage {
  return {
    id: row.id,
    lowWaterMark: BigInt(row.low_water_mark),
    highWaterMark: BigInt(row.high_water_mark),
    lastAnalyzedAt: row.last_analyzed_at,
    updatedAt: row.updated_at,
  };
}

// Insert a gap (idempotent - ignores duplicates)
export async function insertGap(
  gapType: 'block' | 'milestone',
  startValue: bigint,
  endValue: bigint,
  source: string
): Promise<void> {
  if (startValue > endValue) return; // Invalid gap
  await query(
    `INSERT INTO gaps (gap_type, start_value, end_value, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (gap_type, start_value, end_value) DO NOTHING`,
    [gapType, startValue.toString(), endValue.toString(), source]
  );
}

// Get pending gaps for gapfiller (recent first)
export async function getPendingGaps(
  gapType: 'block' | 'milestone',
  limit = 10
): Promise<Gap[]> {
  const rows = await query<GapRow>(
    `SELECT * FROM gaps
     WHERE gap_type = $1 AND status = 'pending'
     ORDER BY end_value DESC
     LIMIT $2`,
    [gapType, limit]
  );
  return rows.map(rowToGap);
}

// Mark gap as filling (returns true if successfully claimed)
export async function claimGap(gapId: number): Promise<boolean> {
  const result = await query(
    `UPDATE gaps SET status = 'filling'
     WHERE id = $1 AND status = 'pending'
     RETURNING id`,
    [gapId]
  );
  return result.length > 0;
}

// Mark gap as filled
export async function markGapFilled(gapId: number): Promise<void> {
  await query(
    `UPDATE gaps SET status = 'filled', filled_at = NOW()
     WHERE id = $1`,
    [gapId]
  );
}

// Shrink gap range (for partial fills)
export async function shrinkGap(
  gapId: number,
  newStartValue: bigint,
  newEndValue: bigint
): Promise<void> {
  if (newStartValue > newEndValue) {
    // Gap fully filled
    await markGapFilled(gapId);
    return;
  }
  await query(
    `UPDATE gaps SET start_value = $2, end_value = $3, status = 'pending'
     WHERE id = $1`,
    [gapId, newStartValue.toString(), newEndValue.toString()]
  );
}

// Release gap back to pending (if filling failed)
export async function releaseGap(gapId: number): Promise<void> {
  await query(
    `UPDATE gaps SET status = 'pending' WHERE id = $1`,
    [gapId]
  );
}

// Get data coverage
export async function getDataCoverage(id: string): Promise<DataCoverage | null> {
  const row = await queryOne<CoverageRow>(
    `SELECT * FROM data_coverage WHERE id = $1`,
    [id]
  );
  return row ? rowToCoverage(row) : null;
}

// Initialize or update data coverage
export async function upsertDataCoverage(
  id: string,
  lowWaterMark: bigint,
  highWaterMark: bigint
): Promise<void> {
  await query(
    `INSERT INTO data_coverage (id, low_water_mark, high_water_mark, last_analyzed_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       low_water_mark = LEAST(data_coverage.low_water_mark, $2),
       high_water_mark = GREATEST(data_coverage.high_water_mark, $3),
       last_analyzed_at = NOW(),
       updated_at = NOW()`,
    [id, lowWaterMark.toString(), highWaterMark.toString()]
  );
}

// Update water marks explicitly
export async function updateWaterMarks(
  id: string,
  lowWaterMark: bigint,
  highWaterMark: bigint
): Promise<void> {
  await query(
    `UPDATE data_coverage SET
       low_water_mark = $2,
       high_water_mark = $3,
       last_analyzed_at = NOW(),
       updated_at = NOW()
     WHERE id = $1`,
    [id, lowWaterMark.toString(), highWaterMark.toString()]
  );
}

// Get gap statistics for status page
export async function getGapStats(gapType: 'block' | 'milestone'): Promise<{
  pendingCount: number;
  totalPendingSize: number;
  fillingCount: number;
}> {
  const row = await queryOne<{
    pending_count: string;
    total_pending_size: string;
    filling_count: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending')::text as pending_count,
       COALESCE(SUM(gap_size) FILTER (WHERE status = 'pending'), 0)::text as total_pending_size,
       COUNT(*) FILTER (WHERE status = 'filling')::text as filling_count
     FROM gaps
     WHERE gap_type = $1`,
    [gapType]
  );
  return {
    pendingCount: parseInt(row?.pending_count ?? '0', 10),
    totalPendingSize: parseInt(row?.total_pending_size ?? '0', 10),
    fillingCount: parseInt(row?.filling_count ?? '0', 10),
  };
}
```

**Step 2: Commit**

```bash
git add src/lib/queries/gaps.ts
git commit -m "feat: add gaps query module"
```

---

## Task 3: GapAnalyzer Worker

**Files:**
- Create: `src/lib/workers/gapAnalyzer.ts`

**Step 1: Create GapAnalyzer worker**

```typescript
import { query, queryOne } from '@/lib/db';
import { insertGap, getDataCoverage, upsertDataCoverage, updateWaterMarks } from '@/lib/queries/gaps';
import { sleep } from '@/lib/utils';

const ANALYZE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = 10000; // Validate up to 10k items per direction per run
const BUFFER = 100; // Don't analyze within 100 of current tip

export class GapAnalyzer {
  private running = false;
  private firstRun = true;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log('[GapAnalyzer] Starting...');
    this.analyze();
  }

  stop(): void {
    this.running = false;
  }

  private async analyze(): Promise<void> {
    while (this.running) {
      try {
        await this.runAnalysis();

        if (this.firstRun) {
          this.firstRun = false;
          console.log('[GapAnalyzer] First run complete, next run in 5 minutes');
        }

        await sleep(ANALYZE_INTERVAL_MS);
      } catch (error) {
        console.error('[GapAnalyzer] Error:', error);
        await sleep(60000); // Wait 1 minute on error
      }
    }
  }

  private async runAnalysis(): Promise<void> {
    await this.analyzeBlocks();
    await this.analyzeMilestones();
  }

  private async analyzeBlocks(): Promise<void> {
    // Get current block boundaries
    const boundaries = await queryOne<{
      min_block: string | null;
      max_block: string | null;
    }>(`SELECT MIN(block_number)::text as min_block, MAX(block_number)::text as max_block FROM blocks`);

    if (!boundaries?.min_block || !boundaries?.max_block) {
      console.log('[GapAnalyzer] No blocks in DB yet');
      return;
    }

    const minBlock = BigInt(boundaries.min_block);
    const maxBlock = BigInt(boundaries.max_block);
    const safeMax = maxBlock - BigInt(BUFFER);
    const safeMin = minBlock + BigInt(BUFFER);

    // Get or initialize coverage
    let coverage = await getDataCoverage('blocks');
    if (!coverage) {
      // Initialize coverage at the minimum block
      await upsertDataCoverage('blocks', minBlock, minBlock);
      coverage = await getDataCoverage('blocks');
      console.log(`[GapAnalyzer] Initialized block coverage at ${minBlock}`);
    }

    let gapsFound = 0;

    // Scan UP: from high_water_mark to safeMax
    if (coverage!.highWaterMark < safeMax) {
      const scanStart = coverage!.highWaterMark + 1n;
      const scanEnd = scanStart + BigInt(BATCH_SIZE) - 1n < safeMax
        ? scanStart + BigInt(BATCH_SIZE) - 1n
        : safeMax;

      const gaps = await this.findBlockGaps(scanStart, scanEnd);
      for (const gap of gaps) {
        await insertGap('block', gap.start, gap.end, 'analyzer');
        gapsFound++;
      }

      // Update high water mark
      await updateWaterMarks('blocks', coverage!.lowWaterMark, scanEnd);
    }

    // Scan DOWN: from safeMin to low_water_mark
    if (coverage!.lowWaterMark > safeMin) {
      const scanEnd = coverage!.lowWaterMark - 1n;
      const scanStart = scanEnd - BigInt(BATCH_SIZE) + 1n > safeMin
        ? scanEnd - BigInt(BATCH_SIZE) + 1n
        : safeMin;

      const gaps = await this.findBlockGaps(scanStart, scanEnd);
      for (const gap of gaps) {
        await insertGap('block', gap.start, gap.end, 'analyzer');
        gapsFound++;
      }

      // Update low water mark
      await updateWaterMarks('blocks', scanStart, coverage!.highWaterMark);
    }

    if (gapsFound > 0) {
      console.log(`[GapAnalyzer] Found ${gapsFound} block gaps`);
    }
  }

  private async analyzeMilestones(): Promise<void> {
    // Get current milestone boundaries
    const boundaries = await queryOne<{
      min_seq: string | null;
      max_seq: string | null;
    }>(`SELECT MIN(sequence_id)::text as min_seq, MAX(sequence_id)::text as max_seq FROM milestones`);

    if (!boundaries?.min_seq || !boundaries?.max_seq) {
      console.log('[GapAnalyzer] No milestones in DB yet');
      return;
    }

    const minSeq = BigInt(boundaries.min_seq);
    const maxSeq = BigInt(boundaries.max_seq);
    const safeMax = maxSeq - BigInt(BUFFER);
    const safeMin = minSeq + BigInt(BUFFER);

    // Get or initialize coverage
    let coverage = await getDataCoverage('milestones');
    if (!coverage) {
      await upsertDataCoverage('milestones', minSeq, minSeq);
      coverage = await getDataCoverage('milestones');
      console.log(`[GapAnalyzer] Initialized milestone coverage at ${minSeq}`);
    }

    let gapsFound = 0;

    // Scan UP
    if (coverage!.highWaterMark < safeMax) {
      const scanStart = coverage!.highWaterMark + 1n;
      const scanEnd = scanStart + BigInt(BATCH_SIZE) - 1n < safeMax
        ? scanStart + BigInt(BATCH_SIZE) - 1n
        : safeMax;

      const gaps = await this.findMilestoneGaps(scanStart, scanEnd);
      for (const gap of gaps) {
        await insertGap('milestone', gap.start, gap.end, 'analyzer');
        gapsFound++;
      }

      await updateWaterMarks('milestones', coverage!.lowWaterMark, scanEnd);
    }

    // Scan DOWN
    if (coverage!.lowWaterMark > safeMin) {
      const scanEnd = coverage!.lowWaterMark - 1n;
      const scanStart = scanEnd - BigInt(BATCH_SIZE) + 1n > safeMin
        ? scanEnd - BigInt(BATCH_SIZE) + 1n
        : safeMin;

      const gaps = await this.findMilestoneGaps(scanStart, scanEnd);
      for (const gap of gaps) {
        await insertGap('milestone', gap.start, gap.end, 'analyzer');
        gapsFound++;
      }

      await updateWaterMarks('milestones', scanStart, coverage!.highWaterMark);
    }

    if (gapsFound > 0) {
      console.log(`[GapAnalyzer] Found ${gapsFound} milestone gaps`);
    }
  }

  private async findBlockGaps(start: bigint, end: bigint): Promise<Array<{start: bigint, end: bigint}>> {
    const rows = await query<{ gap_start: string; gap_end: string }>(
      `WITH expected AS (
        SELECT generate_series($1::bigint, $2::bigint) AS block_number
      ),
      missing AS (
        SELECT e.block_number
        FROM expected e
        LEFT JOIN blocks b ON e.block_number = b.block_number
        WHERE b.block_number IS NULL
      ),
      grouped AS (
        SELECT block_number,
               block_number - ROW_NUMBER() OVER (ORDER BY block_number) AS grp
        FROM missing
      )
      SELECT MIN(block_number)::text as gap_start, MAX(block_number)::text as gap_end
      FROM grouped
      GROUP BY grp`,
      [start.toString(), end.toString()]
    );

    return rows.map(r => ({
      start: BigInt(r.gap_start),
      end: BigInt(r.gap_end)
    }));
  }

  private async findMilestoneGaps(start: bigint, end: bigint): Promise<Array<{start: bigint, end: bigint}>> {
    const rows = await query<{ gap_start: string; gap_end: string }>(
      `WITH expected AS (
        SELECT generate_series($1::bigint, $2::bigint) AS sequence_id
      ),
      missing AS (
        SELECT e.sequence_id
        FROM expected e
        LEFT JOIN milestones m ON e.sequence_id = m.sequence_id
        WHERE m.sequence_id IS NULL
      ),
      grouped AS (
        SELECT sequence_id,
               sequence_id - ROW_NUMBER() OVER (ORDER BY sequence_id) AS grp
        FROM missing
      )
      SELECT MIN(sequence_id)::text as gap_start, MAX(sequence_id)::text as gap_end
      FROM grouped
      GROUP BY grp`,
      [start.toString(), end.toString()]
    );

    return rows.map(r => ({
      start: BigInt(r.gap_start),
      end: BigInt(r.gap_end)
    }));
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/workers/gapAnalyzer.ts
git commit -m "feat: add GapAnalyzer worker"
```

---

## Task 4: Gapfiller Worker

**Files:**
- Create: `src/lib/workers/gapfiller.ts`

**Step 1: Create Gapfiller worker**

```typescript
import { getRpcClient, RpcExhaustedError } from '@/lib/rpc';
import { getHeimdallClient, HeimdallExhaustedError } from '@/lib/heimdall';
import { calculateBlockMetrics } from '@/lib/gas';
import { insertBlocksBatch } from '@/lib/queries/blocks';
import { insertMilestonesBatch, reconcileBlocksForMilestones } from '@/lib/queries/milestones';
import { getPendingGaps, claimGap, markGapFilled, shrinkGap, releaseGap, Gap } from '@/lib/queries/gaps';
import { Block } from '@/lib/types';
import { sleep } from '@/lib/utils';

const EXHAUSTED_RETRY_MS = 5000;
const CHUNK_SIZE = 10; // Process gaps in chunks

export class Gapfiller {
  private running = false;
  private delayMs: number;

  constructor(delayMs = 100) {
    this.delayMs = delayMs;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log('[Gapfiller] Starting...');
    this.fill();
  }

  stop(): void {
    this.running = false;
  }

  private async fill(): Promise<void> {
    while (this.running) {
      try {
        // Try block gaps first, then milestone gaps
        const filledBlock = await this.fillNextGap('block');
        const filledMilestone = await this.fillNextGap('milestone');

        if (!filledBlock && !filledMilestone) {
          // No gaps to fill, wait before checking again
          await sleep(5000);
        } else {
          await sleep(this.delayMs);
        }
      } catch (error) {
        if (error instanceof RpcExhaustedError || error instanceof HeimdallExhaustedError) {
          console.error('[Gapfiller] API exhausted, waiting 5s...');
          await sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[Gapfiller] Error:', error);
          await sleep(5000);
        }
      }
    }
  }

  private async fillNextGap(gapType: 'block' | 'milestone'): Promise<boolean> {
    const gaps = await getPendingGaps(gapType, 1);
    if (gaps.length === 0) return false;

    const gap = gaps[0];
    const claimed = await claimGap(gap.id);
    if (!claimed) return false; // Another worker got it

    try {
      if (gapType === 'block') {
        await this.fillBlockGap(gap);
      } else {
        await this.fillMilestoneGap(gap);
      }
      return true;
    } catch (error) {
      // Release gap back to pending on failure
      await releaseGap(gap.id);
      throw error;
    }
  }

  private async fillBlockGap(gap: Gap): Promise<void> {
    const rpc = getRpcClient();
    const start = gap.startValue;
    const end = gap.endValue;
    const total = Number(end - start) + 1;

    console.log(`[Gapfiller] Filling block gap ${start}-${end} (${total} blocks)`);

    // Process in chunks
    let currentStart = start;
    while (currentStart <= end && this.running) {
      const chunkEnd = currentStart + BigInt(CHUNK_SIZE) - 1n > end
        ? end
        : currentStart + BigInt(CHUNK_SIZE) - 1n;

      const blocks: Omit<Block, 'createdAt' | 'updatedAt'>[] = [];
      const blockNumbers: bigint[] = [];

      for (let num = currentStart; num <= chunkEnd; num++) {
        blockNumbers.push(num);
      }

      const blockPromises = blockNumbers.map(async (blockNum) => {
        const block = await rpc.getBlockWithTransactions(blockNum);

        let previousTimestamp: bigint | undefined;
        if (blockNum > 0n) {
          const prevBlock = await rpc.getBlock(blockNum - 1n);
          previousTimestamp = prevBlock.timestamp;
        }

        const metrics = calculateBlockMetrics(block, previousTimestamp);

        return {
          blockNumber: blockNum,
          timestamp: new Date(Number(block.timestamp) * 1000),
          blockHash: block.hash,
          parentHash: block.parentHash,
          gasUsed: block.gasUsed,
          gasLimit: block.gasLimit,
          baseFeeGwei: metrics.baseFeeGwei,
          minPriorityFeeGwei: metrics.minPriorityFeeGwei,
          maxPriorityFeeGwei: metrics.maxPriorityFeeGwei,
          avgPriorityFeeGwei: metrics.avgPriorityFeeGwei,
          medianPriorityFeeGwei: metrics.medianPriorityFeeGwei,
          totalBaseFeeGwei: metrics.totalBaseFeeGwei,
          totalPriorityFeeGwei: metrics.totalPriorityFeeGwei,
          txCount: block.transactions.length,
          blockTimeSec: metrics.blockTimeSec,
          mgasPerSec: metrics.mgasPerSec,
          tps: metrics.tps,
          finalized: false,
          finalizedAt: null,
          milestoneId: null,
          timeToFinalitySec: null,
        };
      });

      const results = await Promise.all(blockPromises);
      blocks.push(...results);

      if (blocks.length > 0) {
        await insertBlocksBatch(blocks);
      }

      currentStart = chunkEnd + 1n;

      // Update gap progress
      if (currentStart <= end) {
        await shrinkGap(gap.id, currentStart, end);
      }

      await sleep(this.delayMs);
    }

    await markGapFilled(gap.id);
    console.log(`[Gapfiller] Completed block gap ${start}-${end}`);
  }

  private async fillMilestoneGap(gap: Gap): Promise<void> {
    const heimdall = getHeimdallClient();
    const start = Number(gap.startValue);
    const end = Number(gap.endValue);
    const total = end - start + 1;

    console.log(`[Gapfiller] Filling milestone gap ${start}-${end} (${total} milestones)`);

    // Process in chunks
    let currentStart = start;
    while (currentStart <= end && this.running) {
      const chunkEnd = currentStart + CHUNK_SIZE - 1 > end
        ? end
        : currentStart + CHUNK_SIZE - 1;

      const seqIds = Array.from(
        { length: chunkEnd - currentStart + 1 },
        (_, i) => currentStart + i
      );

      const fetchPromises = seqIds.map(async (seqId) => {
        try {
          return await heimdall.getMilestone(seqId);
        } catch {
          console.warn(`[Gapfiller] Failed to fetch milestone ${seqId}`);
          return null;
        }
      });

      const results = await Promise.all(fetchPromises);
      const milestones = results.filter((m): m is NonNullable<typeof m> => m !== null);

      if (milestones.length > 0) {
        await insertMilestonesBatch(milestones);
        await reconcileBlocksForMilestones(milestones);
      }

      currentStart = chunkEnd + 1;

      // Update gap progress
      if (currentStart <= end) {
        await shrinkGap(gap.id, BigInt(currentStart), BigInt(end));
      }

      await sleep(this.delayMs);
    }

    await markGapFilled(gap.id);
    console.log(`[Gapfiller] Completed milestone gap ${start}-${end}`);
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/workers/gapfiller.ts
git commit -m "feat: add Gapfiller worker"
```

---

## Task 5: Modify LivePoller to Insert Gaps

**Files:**
- Modify: `src/lib/workers/livePoller.ts:1-9` (add import)
- Modify: `src/lib/workers/livePoller.ts:67-72` (add gap insertion)

**Step 1: Add import for insertGap**

Add after line 9:
```typescript
import { insertGap } from '@/lib/queries/gaps';
```

**Step 2: Modify skip logic to insert gap**

Replace lines 67-72 (the gap skip block):
```typescript
    // If gap is too large, skip to near the tip and let gapfiller handle the gap
    if (gap > BigInt(MAX_GAP)) {
      const skippedFrom = this.lastProcessedBlock + 1n;
      const skippedTo = latestBlockNumber - BigInt(MAX_GAP) - 1n;
      this.lastProcessedBlock = latestBlockNumber - BigInt(MAX_GAP);

      // Record gap for gapfiller
      await insertGap('block', skippedFrom, skippedTo, 'live_poller');
      console.log(`[LivePoller] Gap too large (${gap} blocks), recorded gap ${skippedFrom}-${skippedTo} for gapfiller`);
    }
```

**Step 3: Commit**

```bash
git add src/lib/workers/livePoller.ts
git commit -m "feat: LivePoller inserts gaps when skipping"
```

---

## Task 6: Modify MilestonePoller to Insert Gaps

**Files:**
- Modify: `src/lib/workers/milestonePoller.ts:1-8` (add import)
- Modify: `src/lib/workers/milestonePoller.ts:74-79` (add gap insertion)

**Step 1: Add import for insertGap**

Add after line 8:
```typescript
import { insertGap } from '@/lib/queries/gaps';
```

**Step 2: Modify skip logic to insert gap**

Replace lines 74-79 (the gap skip block):
```typescript
    // If gap is too large, skip to near the tip and let gapfiller handle
    if (gap > MAX_GAP) {
      const skippedFrom = this.lastSequenceId + 1;
      const skippedTo = currentCount - MAX_GAP - 1;
      this.lastSequenceId = currentCount - MAX_GAP;

      // Record gap for gapfiller
      await insertGap('milestone', BigInt(skippedFrom), BigInt(skippedTo), 'milestone_poller');
      console.log(`[MilestonePoller] Gap too large (${gap} milestones), recorded gap ${skippedFrom}-${skippedTo} for gapfiller`);
    }
```

**Step 3: Commit**

```bash
git add src/lib/workers/milestonePoller.ts
git commit -m "feat: MilestonePoller inserts gaps when skipping"
```

---

## Task 7: Update Worker Index

**Files:**
- Modify: `src/lib/workers/index.ts`

**Step 1: Add imports and variables**

Replace lines 1-12 with:
```typescript
import { LivePoller } from './livePoller';
import { MilestonePoller } from './milestonePoller';
import { Backfiller } from './backfiller';
import { MilestoneBackfiller } from './milestoneBackfiller';
import { FinalityReconciler } from './finalityReconciler';
import { GapAnalyzer } from './gapAnalyzer';
import { Gapfiller } from './gapfiller';

let livePoller: LivePoller | null = null;
let milestonePoller: MilestonePoller | null = null;
let backfiller: Backfiller | null = null;
let milestoneBackfiller: MilestoneBackfiller | null = null;
let finalityReconciler: FinalityReconciler | null = null;
let gapAnalyzer: GapAnalyzer | null = null;
let gapfiller: Gapfiller | null = null;
let workersStarted = false;
```

**Step 2: Update startWorkers function**

Replace lines 32-45 with:
```typescript
  // Start workers
  livePoller = new LivePoller();
  milestonePoller = new MilestonePoller();
  backfiller = new Backfiller(targetBlock, batchSize, delayMs);
  milestoneBackfiller = new MilestoneBackfiller(targetBlock);
  finalityReconciler = new FinalityReconciler();
  gapAnalyzer = new GapAnalyzer();
  gapfiller = new Gapfiller(delayMs);

  await Promise.all([
    livePoller.start(),
    milestonePoller.start(),
    backfiller.start(),
    milestoneBackfiller.start(),
    finalityReconciler.start(),
    gapAnalyzer.start(),
    gapfiller.start(),
  ]);
```

**Step 3: Update stopWorkers function**

Replace lines 52-58 with:
```typescript
export function stopWorkers(): void {
  console.log('[Workers] Stopping workers...');
  livePoller?.stop();
  milestonePoller?.stop();
  backfiller?.stop();
  milestoneBackfiller?.stop();
  finalityReconciler?.stop();
  gapAnalyzer?.stop();
  gapfiller?.stop();
}
```

**Step 4: Commit**

```bash
git add src/lib/workers/index.ts
git commit -m "feat: add GapAnalyzer and Gapfiller to worker index"
```

---

## Task 8: Update Status API Route

**Files:**
- Modify: `src/app/api/status/route.ts`

**Step 1: Replace entire file**

```typescript
import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { areWorkersRunning } from '@/lib/workers';
import { getPendingGaps, getGapStats, getDataCoverage } from '@/lib/queries/gaps';

export const dynamic = 'force-dynamic';

interface BlockStats {
  min_block: string | null;
  max_block: string | null;
  total_count: string;
  finalized_count: string;
  min_finalized: string | null;
  max_finalized: string | null;
}

interface MilestoneStats {
  min_seq: string | null;
  max_seq: string | null;
  min_start_block: string | null;
  max_end_block: string | null;
  total_count: string;
}

export async function GET() {
  try {
    // Get block statistics
    const blockStats = await queryOne<BlockStats>(`
      SELECT
        MIN(block_number)::text as min_block,
        MAX(block_number)::text as max_block,
        COUNT(*)::text as total_count,
        COUNT(*) FILTER (WHERE finalized = true)::text as finalized_count,
        MIN(block_number) FILTER (WHERE finalized = true)::text as min_finalized,
        MAX(block_number) FILTER (WHERE finalized = true)::text as max_finalized
      FROM blocks
    `);

    // Get milestone statistics
    const milestoneStats = await queryOne<MilestoneStats>(`
      SELECT
        MIN(sequence_id)::text as min_seq,
        MAX(sequence_id)::text as max_seq,
        MIN(start_block)::text as min_start_block,
        MAX(end_block)::text as max_end_block,
        COUNT(*)::text as total_count
      FROM milestones
    `);

    // Get gaps from gaps table (fast!)
    const [blockGaps, milestoneGaps] = await Promise.all([
      getPendingGaps('block', 20),
      getPendingGaps('milestone', 20),
    ]);

    // Get gap statistics
    const [blockGapStats, milestoneGapStats] = await Promise.all([
      getGapStats('block'),
      getGapStats('milestone'),
    ]);

    // Get data coverage
    const [blockCoverage, milestoneCoverage] = await Promise.all([
      getDataCoverage('blocks'),
      getDataCoverage('milestones'),
    ]);

    // Get reconciliation status
    const reconcileStats = await queryOne<{
      unfinalized_in_milestone_range: string;
      total_unfinalized: string;
    }>(`
      SELECT
        COUNT(*) FILTER (
          WHERE finalized = false
          AND block_number >= (SELECT COALESCE(MIN(start_block), 0) FROM milestones)
          AND block_number <= (SELECT COALESCE(MAX(end_block), 0) FROM milestones)
        )::text as unfinalized_in_milestone_range,
        COUNT(*) FILTER (WHERE finalized = false)::text as total_unfinalized
      FROM blocks
    `);

    // Get latest block and milestone timestamps
    const latestBlock = await queryOne<{ block_number: string; timestamp: Date }>(`
      SELECT block_number::text, timestamp FROM blocks ORDER BY block_number DESC LIMIT 1
    `);

    const latestMilestone = await queryOne<{ sequence_id: string; end_block: string; timestamp: Date }>(`
      SELECT sequence_id::text, end_block::text, timestamp FROM milestones ORDER BY sequence_id DESC LIMIT 1
    `);

    const response = {
      workersRunning: areWorkersRunning(),
      timestamp: new Date().toISOString(),
      blocks: {
        min: blockStats?.min_block ?? null,
        max: blockStats?.max_block ?? null,
        total: parseInt(blockStats?.total_count ?? '0', 10),
        finalized: parseInt(blockStats?.finalized_count ?? '0', 10),
        minFinalized: blockStats?.min_finalized ?? null,
        maxFinalized: blockStats?.max_finalized ?? null,
        unfinalized: parseInt(reconcileStats?.total_unfinalized ?? '0', 10),
        unfinalizedInMilestoneRange: parseInt(reconcileStats?.unfinalized_in_milestone_range ?? '0', 10),
        gaps: blockGaps.map(g => ({
          start: g.startValue.toString(),
          end: g.endValue.toString(),
          size: g.gapSize,
          source: g.source,
          createdAt: g.createdAt.toISOString(),
        })),
        gapStats: blockGapStats,
        latest: latestBlock ? {
          blockNumber: latestBlock.block_number,
          timestamp: latestBlock.timestamp.toISOString(),
          age: Math.floor((Date.now() - latestBlock.timestamp.getTime()) / 1000),
        } : null,
      },
      milestones: {
        minSeq: milestoneStats?.min_seq ?? null,
        maxSeq: milestoneStats?.max_seq ?? null,
        minStartBlock: milestoneStats?.min_start_block ?? null,
        maxEndBlock: milestoneStats?.max_end_block ?? null,
        total: parseInt(milestoneStats?.total_count ?? '0', 10),
        gaps: milestoneGaps.map(g => ({
          start: g.startValue.toString(),
          end: g.endValue.toString(),
          size: g.gapSize,
          source: g.source,
          createdAt: g.createdAt.toISOString(),
        })),
        gapStats: milestoneGapStats,
        latest: latestMilestone ? {
          sequenceId: latestMilestone.sequence_id,
          endBlock: latestMilestone.end_block,
          timestamp: latestMilestone.timestamp.toISOString(),
          age: Math.floor((Date.now() - latestMilestone.timestamp.getTime()) / 1000),
        } : null,
      },
      coverage: {
        blocks: blockCoverage ? {
          lowWaterMark: blockCoverage.lowWaterMark.toString(),
          highWaterMark: blockCoverage.highWaterMark.toString(),
          lastAnalyzedAt: blockCoverage.lastAnalyzedAt?.toISOString() ?? null,
        } : null,
        milestones: milestoneCoverage ? {
          lowWaterMark: milestoneCoverage.lowWaterMark.toString(),
          highWaterMark: milestoneCoverage.highWaterMark.toString(),
          lastAnalyzedAt: milestoneCoverage.lastAnalyzedAt?.toISOString() ?? null,
        } : null,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch status' },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/status/route.ts
git commit -m "feat: status API reads gaps from database"
```

---

## Task 9: Update Status Page UI

**Files:**
- Modify: `src/app/status/page.tsx`

**Step 1: Replace entire file**

```typescript
'use client';

import { Nav } from '@/components/Nav';
import { useEffect, useState } from 'react';

interface Gap {
  start: string;
  end: string;
  size: number;
  source: string;
  createdAt: string;
}

interface GapStats {
  pendingCount: number;
  totalPendingSize: number;
  fillingCount: number;
}

interface Coverage {
  lowWaterMark: string;
  highWaterMark: string;
  lastAnalyzedAt: string | null;
}

interface StatusData {
  workersRunning: boolean;
  timestamp: string;
  blocks: {
    min: string | null;
    max: string | null;
    total: number;
    finalized: number;
    minFinalized: string | null;
    maxFinalized: string | null;
    unfinalized: number;
    unfinalizedInMilestoneRange: number;
    gaps: Gap[];
    gapStats: GapStats;
    latest: {
      blockNumber: string;
      timestamp: string;
      age: number;
    } | null;
  };
  milestones: {
    minSeq: string | null;
    maxSeq: string | null;
    minStartBlock: string | null;
    maxEndBlock: string | null;
    total: number;
    gaps: Gap[];
    gapStats: GapStats;
    latest: {
      sequenceId: string;
      endBlock: string;
      timestamp: string;
      age: number;
    } | null;
  };
  coverage: {
    blocks: Coverage | null;
    milestones: Coverage | null;
  };
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

function formatTimeAgo(isoString: string | null): string {
  if (!isoString) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  return formatAge(seconds) + ' ago';
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`px-2 py-1 rounded text-sm font-medium ${
      ok ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'
    }`}>
      {label}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h3 className="text-lg font-semibold text-gray-200 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function StatRow({ label, value, warning }: { label: string; value: string | number; warning?: boolean | null }) {
  return (
    <div className="flex justify-between py-1 border-b border-gray-700 last:border-0">
      <span className="text-gray-400">{label}</span>
      <span className={warning ? 'text-yellow-400 font-medium' : 'text-gray-200'}>{value}</span>
    </div>
  );
}

export default function StatusPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Failed to fetch status');
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gray-900">
      <Nav />

      <main className="w-full px-4 py-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-100">System Status</h1>
          <div className="flex items-center gap-3">
            {status && (
              <>
                <StatusBadge
                  ok={status.workersRunning}
                  label={status.workersRunning ? 'Workers Running' : 'Workers Stopped'}
                />
                <span className="text-gray-500 text-sm">
                  Updated: {new Date(status.timestamp).toLocaleTimeString()}
                </span>
              </>
            )}
          </div>
        </div>

        {loading && !status && (
          <div className="text-gray-400">Loading...</div>
        )}

        {error && (
          <div className="bg-red-900 text-red-200 p-4 rounded-lg mb-4">
            Error: {error}
          </div>
        )}

        {status && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Blocks Overview */}
            <Card title="Blocks">
              <div className="space-y-1">
                <StatRow label="Latest Block" value={status.blocks.latest?.blockNumber ?? 'N/A'} />
                <StatRow
                  label="Latest Block Age"
                  value={status.blocks.latest ? formatAge(status.blocks.latest.age) : 'N/A'}
                  warning={status.blocks.latest && status.blocks.latest.age > 10}
                />
                <StatRow label="Total Blocks" value={formatNumber(status.blocks.total)} />
                <StatRow label="Block Range" value={`${status.blocks.min ?? 'N/A'} - ${status.blocks.max ?? 'N/A'}`} />
                <StatRow label="Finalized" value={formatNumber(status.blocks.finalized)} />
                <StatRow
                  label="Unfinalized (in milestone range)"
                  value={formatNumber(status.blocks.unfinalizedInMilestoneRange)}
                  warning={status.blocks.unfinalizedInMilestoneRange > 100}
                />
                <StatRow label="Total Unfinalized" value={formatNumber(status.blocks.unfinalized)} />
              </div>
            </Card>

            {/* Milestones Overview */}
            <Card title="Milestones">
              <div className="space-y-1">
                <StatRow label="Latest Sequence" value={status.milestones.latest?.sequenceId ?? 'N/A'} />
                <StatRow
                  label="Latest Milestone Age"
                  value={status.milestones.latest ? formatAge(status.milestones.latest.age) : 'N/A'}
                  warning={status.milestones.latest && status.milestones.latest.age > 30}
                />
                <StatRow label="Latest End Block" value={status.milestones.latest?.endBlock ?? 'N/A'} />
                <StatRow label="Total Milestones" value={formatNumber(status.milestones.total)} />
                <StatRow label="Sequence Range" value={`${status.milestones.minSeq ?? 'N/A'} - ${status.milestones.maxSeq ?? 'N/A'}`} />
                <StatRow label="Block Coverage" value={`${status.milestones.minStartBlock ?? 'N/A'} - ${status.milestones.maxEndBlock ?? 'N/A'}`} />
              </div>
            </Card>

            {/* Data Coverage */}
            <Card title="Data Coverage (Validated Ranges)">
              <div className="space-y-3">
                <div>
                  <div className="text-gray-400 text-sm mb-1">Blocks</div>
                  {status.coverage.blocks ? (
                    <div className="text-gray-200">
                      <div>{status.coverage.blocks.lowWaterMark} → {status.coverage.blocks.highWaterMark}</div>
                      <div className="text-gray-500 text-sm">
                        Last analyzed: {formatTimeAgo(status.coverage.blocks.lastAnalyzedAt)}
                      </div>
                    </div>
                  ) : (
                    <div className="text-yellow-400">Not yet analyzed</div>
                  )}
                </div>
                <div>
                  <div className="text-gray-400 text-sm mb-1">Milestones</div>
                  {status.coverage.milestones ? (
                    <div className="text-gray-200">
                      <div>{status.coverage.milestones.lowWaterMark} → {status.coverage.milestones.highWaterMark}</div>
                      <div className="text-gray-500 text-sm">
                        Last analyzed: {formatTimeAgo(status.coverage.milestones.lastAnalyzedAt)}
                      </div>
                    </div>
                  ) : (
                    <div className="text-yellow-400">Not yet analyzed</div>
                  )}
                </div>
              </div>
            </Card>

            {/* Gap Statistics */}
            <Card title="Gap Statistics">
              <div className="space-y-3">
                <div>
                  <div className="text-gray-400 text-sm mb-1">Block Gaps</div>
                  <div className="text-gray-200">
                    <span className={status.blocks.gapStats.pendingCount > 0 ? 'text-yellow-400' : 'text-green-400'}>
                      {status.blocks.gapStats.pendingCount} pending
                    </span>
                    {status.blocks.gapStats.pendingCount > 0 && (
                      <span className="text-gray-500 ml-2">
                        ({formatNumber(status.blocks.gapStats.totalPendingSize)} blocks)
                      </span>
                    )}
                    {status.blocks.gapStats.fillingCount > 0 && (
                      <span className="text-blue-400 ml-2">
                        {status.blocks.gapStats.fillingCount} filling
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400 text-sm mb-1">Milestone Gaps</div>
                  <div className="text-gray-200">
                    <span className={status.milestones.gapStats.pendingCount > 0 ? 'text-yellow-400' : 'text-green-400'}>
                      {status.milestones.gapStats.pendingCount} pending
                    </span>
                    {status.milestones.gapStats.pendingCount > 0 && (
                      <span className="text-gray-500 ml-2">
                        ({formatNumber(status.milestones.gapStats.totalPendingSize)} milestones)
                      </span>
                    )}
                    {status.milestones.gapStats.fillingCount > 0 && (
                      <span className="text-blue-400 ml-2">
                        {status.milestones.gapStats.fillingCount} filling
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            {/* Block Gaps */}
            <Card title="Pending Block Gaps">
              {status.blocks.gaps.length === 0 ? (
                <div className="text-green-400">No gaps detected</div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {status.blocks.gaps.map((gap, i) => (
                    <div key={i} className="flex justify-between items-center py-1 border-b border-gray-700 last:border-0">
                      <div>
                        <span className="text-gray-400">{gap.start} - {gap.end}</span>
                        <span className="text-gray-600 text-xs ml-2">({gap.source})</span>
                      </div>
                      <span className="text-yellow-400">{formatNumber(gap.size)} blocks</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Milestone Gaps */}
            <Card title="Pending Milestone Gaps">
              {status.milestones.gaps.length === 0 ? (
                <div className="text-green-400">No gaps detected</div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {status.milestones.gaps.map((gap, i) => (
                    <div key={i} className="flex justify-between items-center py-1 border-b border-gray-700 last:border-0">
                      <div>
                        <span className="text-gray-400">Seq {gap.start} - {gap.end}</span>
                        <span className="text-gray-600 text-xs ml-2">({gap.source})</span>
                      </div>
                      <span className="text-yellow-400">{formatNumber(gap.size)} milestones</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Sync Status */}
            <Card title="Sync Status">
              <div className="space-y-3">
                <div>
                  <div className="text-gray-400 text-sm mb-1">Block to Milestone Sync</div>
                  {status.blocks.latest && status.milestones.latest ? (
                    <div className="text-gray-200">
                      {(() => {
                        const blockDiff = BigInt(status.blocks.latest.blockNumber) - BigInt(status.milestones.latest.endBlock);
                        const isAhead = blockDiff > 0n;
                        return (
                          <span className={blockDiff > 100n ? 'text-yellow-400' : 'text-green-400'}>
                            Blocks {isAhead ? 'ahead' : 'behind'} milestones by {formatNumber(Math.abs(Number(blockDiff)))}
                          </span>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="text-gray-500">N/A</div>
                  )}
                </div>
                <div>
                  <div className="text-gray-400 text-sm mb-1">Finalization Coverage</div>
                  {status.blocks.finalized > 0 ? (
                    <div className="text-gray-200">
                      {status.blocks.minFinalized} - {status.blocks.maxFinalized}
                      <span className="text-gray-500 ml-2">
                        ({((status.blocks.finalized / status.blocks.total) * 100).toFixed(1)}% finalized)
                      </span>
                    </div>
                  ) : (
                    <div className="text-yellow-400">No finalized blocks yet</div>
                  )}
                </div>
              </div>
            </Card>

            {/* Health Indicators */}
            <Card title="Health Indicators">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Workers</span>
                  <StatusBadge ok={status.workersRunning} label={status.workersRunning ? 'OK' : 'Stopped'} />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Block Freshness</span>
                  <StatusBadge
                    ok={!status.blocks.latest || status.blocks.latest.age < 10}
                    label={status.blocks.latest && status.blocks.latest.age > 10 ? 'Stale' : 'OK'}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Milestone Freshness</span>
                  <StatusBadge
                    ok={!status.milestones.latest || status.milestones.latest.age < 30}
                    label={status.milestones.latest && status.milestones.latest.age > 30 ? 'Stale' : 'OK'}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Block Gaps</span>
                  <StatusBadge
                    ok={status.blocks.gapStats.pendingCount === 0}
                    label={status.blocks.gapStats.pendingCount > 0 ? `${status.blocks.gapStats.pendingCount} gaps` : 'None'}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Milestone Gaps</span>
                  <StatusBadge
                    ok={status.milestones.gapStats.pendingCount === 0}
                    label={status.milestones.gapStats.pendingCount > 0 ? `${status.milestones.gapStats.pendingCount} gaps` : 'None'}
                  />
                </div>
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/status/page.tsx
git commit -m "feat: update status page UI with coverage and gap stats"
```

---

## Task 10: Deploy and Test on Docker

**Step 1: Apply database migration**

Run: `docker compose exec -T db psql -U polygon -d polygon_dashboard < docker/migrations/20260111_gap_analysis_tables.sql`
Expected: No errors

**Step 2: Rebuild and restart containers**

Run: `docker compose down && docker compose up -d --build`
Expected: Containers start successfully

**Step 3: Check logs for new workers**

Run: `docker compose logs -f app 2>&1 | head -100`
Expected: See "[GapAnalyzer] Starting..." and "[Gapfiller] Starting..." in logs

**Step 4: Verify status page**

Run: `curl -s http://localhost:3000/api/status | jq '.coverage, .blocks.gapStats, .milestones.gapStats'`
Expected: See coverage and gapStats fields in response

**Step 5: Commit all changes**

```bash
git add -A
git commit -m "feat: complete gap analysis system implementation"
```

---

## Summary

This implementation adds:
1. **Database tables**: `gaps` and `data_coverage` for efficient storage
2. **GapAnalyzer worker**: Scans for gaps every 5 minutes, updates water marks
3. **Gapfiller worker**: Fills gaps from DB, recent first
4. **Poller modifications**: Insert gaps immediately when skipping
5. **Status API**: Reads from tables instead of computing gaps
6. **Status UI**: Shows coverage ranges, gap statistics, and pending gaps
