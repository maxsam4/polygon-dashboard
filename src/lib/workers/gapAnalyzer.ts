import { query, queryOne } from '@/lib/db';
import { insertGap, getDataCoverage, upsertDataCoverage, updateWaterMarks } from '@/lib/queries/gaps';
import { sleep } from '@/lib/utils';

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

    console.log('[GapAnalyzer] Starting gap analysis');
    this.analyze();
  }

  stop(): void {
    this.running = false;
  }

  private async analyze(): Promise<void> {
    while (this.running) {
      try {
        await this.runAnalysis();
        this.firstRun = false;
        await sleep(ANALYZE_INTERVAL_MS);
      } catch (error) {
        console.error('[GapAnalyzer] Error:', error);
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

    const elapsed = Date.now() - startTime;
    console.log(`[GapAnalyzer] Analysis complete in ${elapsed}ms`);
  }

  private async analyzeBlocks(): Promise<void> {
    // Get min/max block_number from blocks table
    const range = await queryOne<{ min_block: string; max_block: string }>(
      `SELECT MIN(block_number)::text as min_block, MAX(block_number)::text as max_block FROM blocks`
    );

    if (!range || !range.min_block || !range.max_block) {
      console.log('[GapAnalyzer] No blocks in database yet');
      return;
    }

    const minBlock = BigInt(range.min_block);
    const maxBlock = BigInt(range.max_block);

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

    if (gapsFound > 0) {
      console.log(`[GapAnalyzer] Found ${gapsFound} block gap(s)`);
    }
  }

  private async analyzeMilestones(): Promise<void> {
    // Get min/max sequence_id from milestones table
    const range = await queryOne<{ min_seq: string; max_seq: string }>(
      `SELECT MIN(sequence_id)::text as min_seq, MAX(sequence_id)::text as max_seq FROM milestones`
    );

    if (!range || !range.min_seq || !range.max_seq) {
      console.log('[GapAnalyzer] No milestones in database yet');
      return;
    }

    const minSeq = BigInt(range.min_seq);
    const maxSeq = BigInt(range.max_seq);

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

    if (gapsFound > 0) {
      console.log(`[GapAnalyzer] Found ${gapsFound} milestone gap(s)`);
    }
  }

  private async analyzeFinalityGaps(): Promise<void> {
    // Get milestone coverage: the range of blocks covered by milestones
    const milestoneCoverage = await queryOne<{ min_start: string; max_end: string }>(
      `SELECT MIN(start_block)::text as min_start, MAX(end_block)::text as max_end FROM milestones`
    );

    if (!milestoneCoverage || !milestoneCoverage.min_start || !milestoneCoverage.max_end) {
      console.log('[GapAnalyzer] No milestones in database, skipping finality gap analysis');
      return;
    }

    const minStart = BigInt(milestoneCoverage.min_start);
    const maxEnd = BigInt(milestoneCoverage.max_end);

    // Find unfinalized blocks within milestone coverage range
    // These are blocks that exist but haven't been reconciled with milestones
    const unfinalizedBlocks = await query<{ block_number: string }>(
      `SELECT block_number::text FROM blocks
       WHERE finalized = FALSE
         AND block_number BETWEEN $1 AND $2
       ORDER BY block_number
       LIMIT $3`,
      [minStart.toString(), maxEnd.toString(), BATCH_SIZE]
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
      console.log(`[GapAnalyzer] Found ${gapsInserted} finality gap(s) covering ${unfinalizedBlocks.length} blocks`);
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
