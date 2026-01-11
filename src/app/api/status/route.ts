import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { areWorkersRunning, getAllWorkerStatuses } from '@/lib/workers';
import { getPendingGaps, getGapStats, getDataCoverage } from '@/lib/queries/gaps';

export const dynamic = 'force-dynamic';

interface BlockStats {
  min_block: string | null;
  max_block: string | null;
  min_timestamp: Date | null;
  max_timestamp: Date | null;
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
  min_timestamp: Date | null;
  max_timestamp: Date | null;
  total_count: string;
}

export async function GET() {
  try {
    // Get block statistics
    const blockStats = await queryOne<BlockStats>(`
      SELECT
        MIN(block_number)::text as min_block,
        MAX(block_number)::text as max_block,
        MIN(timestamp) as min_timestamp,
        MAX(timestamp) as max_timestamp,
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
        MIN(timestamp) as min_timestamp,
        MAX(timestamp) as max_timestamp,
        COUNT(*)::text as total_count
      FROM milestones
    `);

    // Get gaps from gaps table (fast!)
    const [blockGaps, milestoneGaps, finalityGaps] = await Promise.all([
      getPendingGaps('block', 20),
      getPendingGaps('milestone', 20),
      getPendingGaps('finality', 20),
    ]);

    // Get gap statistics
    const [blockGapStats, milestoneGapStats, finalityGapStats] = await Promise.all([
      getGapStats('block'),
      getGapStats('milestone'),
      getGapStats('finality'),
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
      SELECT block_number::text, timestamp FROM blocks ORDER BY block_number::bigint DESC LIMIT 1
    `);

    const latestMilestone = await queryOne<{ sequence_id: string; end_block: string; timestamp: Date }>(`
      SELECT sequence_id::text, end_block::text, timestamp FROM milestones ORDER BY sequence_id::integer DESC LIMIT 1
    `);

    // Get individual worker statuses
    const workerStatuses = getAllWorkerStatuses().map(ws => ({
      name: ws.name,
      state: ws.state,
      lastRunAt: ws.lastRunAt?.toISOString() ?? null,
      lastErrorAt: ws.lastErrorAt?.toISOString() ?? null,
      lastError: ws.lastError,
      itemsProcessed: ws.itemsProcessed,
    }));

    const response = {
      workersRunning: areWorkersRunning(),
      workerStatuses,
      timestamp: new Date().toISOString(),
      blocks: {
        min: blockStats?.min_block ?? null,
        max: blockStats?.max_block ?? null,
        minTimestamp: blockStats?.min_timestamp?.toISOString() ?? null,
        maxTimestamp: blockStats?.max_timestamp?.toISOString() ?? null,
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
        minTimestamp: milestoneStats?.min_timestamp?.toISOString() ?? null,
        maxTimestamp: milestoneStats?.max_timestamp?.toISOString() ?? null,
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
      finality: {
        gaps: finalityGaps.map(g => ({
          start: g.startValue.toString(),
          end: g.endValue.toString(),
          size: g.gapSize,
          source: g.source,
          createdAt: g.createdAt.toISOString(),
        })),
        gapStats: finalityGapStats,
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
