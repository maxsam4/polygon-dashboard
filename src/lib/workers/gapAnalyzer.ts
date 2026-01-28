import { query } from '@/lib/db';
import { insertGap, getDataCoverage, upsertDataCoverage, updateWaterMarks, updateLastAnalyzedAt } from '@/lib/queries/gaps';
import { sleep } from '@/lib/utils';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from './workerStatus';
import { getTableStats } from '@/lib/queries/stats';
import { getMilestoneAggregates } from '@/lib/queries/aggregates';

const WORKER_NAME = 'GapAnalyzer';
const ANALYZE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const ERROR_RETRY_MS = 60 * 1000; // 1 minute
const BATCH_SIZE = 10000; // Validate up to 10k items per direction per run
const BUFFER = 100; // Don't analyze within 100 of current tip/bottom

interface GapRange {
  start: bigint;
  end: bigint;
}

export class GapAnalyzer {
  private running = false;
  private firstRun = true;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    initWorkerStatus(WORKER_NAME);
    updateWorkerState(WORKER_NAME, 'running');

    console.log('[GapAnalyzer] Starting gap analysis');
    this.analyze();
  }

  stop(): void {
    this.running = false;
    updateWorkerState(WORKER_NAME, 'stopped');
  }

  private async analyze(): Promise<void> {
    while (this.running) {
      try {
        updateWorkerState(WORKER_NAME, 'running');
        await this.runAnalysis();
        updateWorkerRun(WORKER_NAME, 1);
        this.firstRun = false;
        updateWorkerState(WORKER_NAME, 'idle');
        await sleep(ANALYZE_INTERVAL_MS);
      } catch (error) {
        console.error('[GapAnalyzer] Error:', error);
        updateWorkerError(WORKER_NAME, error instanceof Error ? error.message : 'Unknown error');
        await sleep(ERROR_RETRY_MS);
      }
    }
  }

  private async runAnalysis(): Promise<void> {
    const startTime = Date.now();
    console.log('[GapAnalyzer] Running analysis...');

    await this.analyzeBlocks();
    await this.analyzeMilestones();
    await this.analyzeFinalityGaps();
    await this.analyzePriorityFeeGaps();

    const elapsed = Date.now() - startTime;
    console.log(`[GapAnalyzer] Analysis complete in ${elapsed}ms`);
  }

  private async analyzeBlocks(): Promise<void> {
    // Use cached stats instead of expensive MIN/MAX query
    const stats = await getTableStats('blocks');

    if (!stats) {
      console.log('[GapAnalyzer] No block stats available yet');
      return;
    }

    const minBlock = stats.minValue;
    const maxBlock = stats.maxValue;

    // Get or initialize data_coverage for 'blocks'
    let coverage = await getDataCoverage('blocks');
    if (!coverage) {
      // Initialize coverage to current min/max
      await upsertDataCoverage('blocks', minBlock, maxBlock);
      coverage = await getDataCoverage('blocks');
      if (!coverage) {
        console.error('[GapAnalyzer] Failed to create blocks coverage');
        return;
      }
    }

    let gapsFound = 0;

    // Scan UP: from high_water_mark to (max_block - BUFFER)
    const upScanEnd = maxBlock - BigInt(BUFFER);
    if (upScanEnd > coverage.highWaterMark) {
      const scanStart = coverage.highWaterMark + 1n;
      const scanEnd = scanStart + BigInt(BATCH_SIZE) - 1n < upScanEnd
        ? scanStart + BigInt(BATCH_SIZE) - 1n
        : upScanEnd;

      const gaps = await this.findBlockGaps(scanStart, scanEnd);
      for (const gap of gaps) {
        await insertGap('block', gap.start, gap.end, 'analyzer');
        gapsFound++;
      }

      // Update high water mark
      await updateWaterMarks('blocks', coverage.lowWaterMark, scanEnd);
      coverage.highWaterMark = scanEnd;
    }

    // Scan DOWN: from (min_block + BUFFER) to low_water_mark
    const downScanStart = minBlock + BigInt(BUFFER);
    if (downScanStart < coverage.lowWaterMark) {
      const scanEnd = coverage.lowWaterMark - 1n;
      const scanStart = scanEnd - BigInt(BATCH_SIZE) + 1n > downScanStart
        ? scanEnd - BigInt(BATCH_SIZE) + 1n
        : downScanStart;

      const gaps = await this.findBlockGaps(scanStart, scanEnd);
      for (const gap of gaps) {
        await insertGap('block', gap.start, gap.end, 'analyzer');
        gapsFound++;
      }

      // Update low water mark
      await updateWaterMarks('blocks', scanStart, coverage.highWaterMark);
    }

    // Update last analyzed timestamp
    await updateLastAnalyzedAt('blocks');

    if (gapsFound > 0) {
      console.log(`[GapAnalyzer] Found ${gapsFound} block gap(s)`);
    }
  }

  private async analyzeMilestones(): Promise<void> {
    // Use cached stats instead of expensive MIN/MAX query
    const stats = await getTableStats('milestones');

    if (!stats) {
      console.log('[GapAnalyzer] No milestone stats available yet');
      return;
    }

    const minSeq = stats.minValue;
    const maxSeq = stats.maxValue;

    // Get or initialize data_coverage for 'milestones'
    let coverage = await getDataCoverage('milestones');
    if (!coverage) {
      // Initialize coverage to current min/max
      await upsertDataCoverage('milestones', minSeq, maxSeq);
      coverage = await getDataCoverage('milestones');
      if (!coverage) {
        console.error('[GapAnalyzer] Failed to create milestones coverage');
        return;
      }
    }

    let gapsFound = 0;

    // Scan UP: from high_water_mark to (max_seq - BUFFER)
    const upScanEnd = maxSeq - BigInt(BUFFER);
    if (upScanEnd > coverage.highWaterMark) {
      const scanStart = coverage.highWaterMark + 1n;
      const scanEnd = scanStart + BigInt(BATCH_SIZE) - 1n < upScanEnd
        ? scanStart + BigInt(BATCH_SIZE) - 1n
        : upScanEnd;

      const gaps = await this.findMilestoneGaps(scanStart, scanEnd);
      for (const gap of gaps) {
        await insertGap('milestone', gap.start, gap.end, 'analyzer');
        gapsFound++;
      }

      // Update high water mark
      await updateWaterMarks('milestones', coverage.lowWaterMark, scanEnd);
      coverage.highWaterMark = scanEnd;
    }

    // Scan DOWN: from (min_seq + BUFFER) to low_water_mark
    const downScanStart = minSeq + BigInt(BUFFER);
    if (downScanStart < coverage.lowWaterMark) {
      const scanEnd = coverage.lowWaterMark - 1n;
      const scanStart = scanEnd - BigInt(BATCH_SIZE) + 1n > downScanStart
        ? scanEnd - BigInt(BATCH_SIZE) + 1n
        : downScanStart;

      const gaps = await this.findMilestoneGaps(scanStart, scanEnd);
      for (const gap of gaps) {
        await insertGap('milestone', gap.start, gap.end, 'analyzer');
        gapsFound++;
      }

      // Update low water mark
      await updateWaterMarks('milestones', scanStart, coverage.highWaterMark);
    }

    // Update last analyzed timestamp
    await updateLastAnalyzedAt('milestones');

    if (gapsFound > 0) {
      console.log(`[GapAnalyzer] Found ${gapsFound} milestone gap(s)`);
    }
  }

  private async analyzeFinalityGaps(): Promise<void> {
    // Use cached milestone aggregates instead of expensive MIN/MAX query
    const milestoneAggregates = await getMilestoneAggregates();

    if (!milestoneAggregates.minStartBlock || !milestoneAggregates.maxEndBlock) {
      console.log('[GapAnalyzer] No milestones in database, skipping finality gap analysis');
      return;
    }

    const minStart = milestoneAggregates.minStartBlock;
    const maxEnd = milestoneAggregates.maxEndBlock;

    // Only detect finality gaps in uncompressed chunks (recent data)
    // Compressed chunks can't be efficiently updated, so we ignore them
    const compressionThreshold = new Date();
    compressionThreshold.setDate(compressionThreshold.getDate() - 10); // 10 days ago

    // Find unfinalized blocks within milestone coverage range AND in uncompressed chunks
    // These are blocks that exist but haven't been reconciled with milestones
    const unfinalizedBlocks = await query<{ block_number: string }>(
      `SELECT block_number::text FROM blocks
       WHERE finalized = FALSE
         AND block_number BETWEEN $1 AND $2
         AND timestamp >= $3
       ORDER BY block_number
       LIMIT $4`,
      [minStart.toString(), maxEnd.toString(), compressionThreshold, BATCH_SIZE]
    );

    if (unfinalizedBlocks.length === 0) {
      return;
    }

    // Group consecutive unfinalized blocks into ranges
    const gaps = this.groupConsecutiveBlocks(
      unfinalizedBlocks.map(row => BigInt(row.block_number))
    );

    let gapsInserted = 0;
    for (const gap of gaps) {
      await insertGap('finality', gap.start, gap.end, 'analyzer');
      gapsInserted++;
    }

    if (gapsInserted > 0) {
      console.log(`[GapAnalyzer] Found ${gapsInserted} finality gap(s) covering ${unfinalizedBlocks.length} blocks (uncompressed only)`);
    }
  }

  private async analyzePriorityFeeGaps(): Promise<void> {
    // Only analyze recent blocks in uncompressed chunks
    // Compressed chunks can't be efficiently updated, so we ignore them
    const compressionThreshold = new Date();
    compressionThreshold.setDate(compressionThreshold.getDate() - 10); // 10 days ago

    // Find blocks with null priority fee metrics (missing gasUsed data)
    // These blocks exist but have incomplete data that needs to be filled
    const blocksWithNullFees = await query<{ block_number: string }>(
      `SELECT block_number::text FROM blocks
       WHERE (avg_priority_fee_gwei IS NULL OR total_priority_fee_gwei IS NULL)
         AND tx_count > 0
         AND timestamp >= $1
       ORDER BY block_number DESC
       LIMIT $2`,
      [compressionThreshold, BATCH_SIZE]
    );

    if (blocksWithNullFees.length === 0) {
      return;
    }

    // Group consecutive blocks into ranges for efficient gap processing
    const gaps = this.groupConsecutiveBlocks(
      blocksWithNullFees.map(row => BigInt(row.block_number))
    );

    let gapsInserted = 0;
    for (const gap of gaps) {
      await insertGap('priority_fee', gap.start, gap.end, 'analyzer');
      gapsInserted++;
    }

    if (gapsInserted > 0) {
      console.log(`[GapAnalyzer] Found ${gapsInserted} priority fee gap(s) covering ${blocksWithNullFees.length} blocks`);
    }
  }

  private async findBlockGaps(start: bigint, end: bigint): Promise<GapRange[]> {
    if (start > end) return [];

    const rows = await query<{ gap_start: string; gap_end: string }>(
      `WITH expected AS (
        SELECT generate_series($1::bigint, $2::bigint) AS block_number
      ),
      missing AS (
        SELECT e.block_number FROM expected e
        LEFT JOIN blocks b ON e.block_number = b.block_number
        WHERE b.block_number IS NULL
      ),
      grouped AS (
        SELECT block_number, block_number - ROW_NUMBER() OVER (ORDER BY block_number) AS grp
        FROM missing
      )
      SELECT MIN(block_number)::text as gap_start, MAX(block_number)::text as gap_end
      FROM grouped GROUP BY grp`,
      [start.toString(), end.toString()]
    );

    return rows.map(row => ({
      start: BigInt(row.gap_start),
      end: BigInt(row.gap_end),
    }));
  }

  private async findMilestoneGaps(start: bigint, end: bigint): Promise<GapRange[]> {
    if (start > end) return [];

    const rows = await query<{ gap_start: string; gap_end: string }>(
      `WITH expected AS (
        SELECT generate_series($1::bigint, $2::bigint) AS sequence_id
      ),
      missing AS (
        SELECT e.sequence_id FROM expected e
        LEFT JOIN milestones m ON e.sequence_id = m.sequence_id
        WHERE m.sequence_id IS NULL
      ),
      grouped AS (
        SELECT sequence_id, sequence_id - ROW_NUMBER() OVER (ORDER BY sequence_id) AS grp
        FROM missing
      )
      SELECT MIN(sequence_id)::text as gap_start, MAX(sequence_id)::text as gap_end
      FROM grouped GROUP BY grp`,
      [start.toString(), end.toString()]
    );

    return rows.map(row => ({
      start: BigInt(row.gap_start),
      end: BigInt(row.gap_end),
    }));
  }

  private groupConsecutiveBlocks(blockNumbers: bigint[]): GapRange[] {
    if (blockNumbers.length === 0) return [];

    const gaps: GapRange[] = [];
    let rangeStart = blockNumbers[0];
    let rangeEnd = blockNumbers[0];

    for (let i = 1; i < blockNumbers.length; i++) {
      if (blockNumbers[i] === rangeEnd + 1n) {
        // Consecutive, extend the range
        rangeEnd = blockNumbers[i];
      } else {
        // Gap in sequence, save current range and start new one
        gaps.push({ start: rangeStart, end: rangeEnd });
        rangeStart = blockNumbers[i];
        rangeEnd = blockNumbers[i];
      }
    }

    // Don't forget the last range
    gaps.push({ start: rangeStart, end: rangeEnd });

    return gaps;
  }
}
