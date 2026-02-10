import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { areWorkersRunning, getAllWorkerStatuses } from '@/lib/workers';
import { getInflationRateCount, getLatestInflationRate } from '@/lib/queries/inflation';
import {
  getBlockAggregates,
  getMilestoneAggregates,
  getLatestBlock,
  getLatestMilestone,
  getPriorityFeeBackfillerProgress,
  getPriorityFeeRecalculatorProgress,
} from '@/lib/queries/aggregates';

export const dynamic = 'force-dynamic';

/**
 * Cached aggregates: block/milestone stats, inflation
 * Cache for 10 seconds to reduce load on compressed chunks
 *
 * Note: All BigInt values must be converted to strings before caching,
 * as JSON serialization (used by unstable_cache) doesn't support BigInt.
 */
const getCachedAggregates = unstable_cache(
  async () => {
    const [blockAggregates, milestoneAggregates, inflationCount, latestInflation] =
      await Promise.all([
        getBlockAggregates(),
        getMilestoneAggregates(),
        getInflationRateCount().catch(() => 0),
        getLatestInflationRate().catch(() => null),
      ]);

    // Convert BigInt and Date values for JSON serialization in cache
    // JSON.stringify converts Date objects to ISO strings, so we do it explicitly
    return {
      blockAggregates: {
        ...blockAggregates,
        minTimestamp: blockAggregates.minTimestamp?.toISOString() ?? null,
        maxTimestamp: blockAggregates.maxTimestamp?.toISOString() ?? null,
      },
      milestoneAggregates: {
        ...milestoneAggregates,
        minTimestamp: milestoneAggregates.minTimestamp?.toISOString() ?? null,
        maxTimestamp: milestoneAggregates.maxTimestamp?.toISOString() ?? null,
      },
      inflation: {
        inflationCount,
        latestInflation: latestInflation ? {
          interestPerYearLog2: latestInflation.interestPerYearLog2.toString(),
          blockTimestamp: latestInflation.blockTimestamp.toISOString(),
        } : null,
      },
    };
  },
  ['status-aggregates'],
  { revalidate: 10 }
);

export async function GET() {
  try {
    // Fetch cached aggregates (slow-changing data)
    const aggregates = await getCachedAggregates();
    const { blockAggregates, milestoneAggregates, inflation } = aggregates;

    // Fetch real-time data (fast queries, not cached)
    const [latestBlock, latestMilestone, priorityFeeBackfillProgress, priorityFeeRecalcProgress] =
      await Promise.all([
        getLatestBlock(),
        getLatestMilestone(),
        getPriorityFeeBackfillerProgress(),
        getPriorityFeeRecalculatorProgress(),
      ]);

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
        min: blockAggregates.minBlock?.toString() ?? null,
        max: blockAggregates.maxBlock?.toString() ?? null,
        minTimestamp: blockAggregates.minTimestamp ?? null,
        maxTimestamp: blockAggregates.maxTimestamp ?? null,
        total: blockAggregates.totalCount?.toString() ?? '0',
        finalized: blockAggregates.finalizedCount?.toString() ?? '0',
        minFinalized: blockAggregates.minFinalized?.toString() ?? null,
        maxFinalized: blockAggregates.maxFinalized?.toString() ?? null,
        latest: latestBlock ? {
          blockNumber: latestBlock.block_number.toString(),
          timestamp: latestBlock.timestamp.toISOString(),
          age: Math.floor((Date.now() - latestBlock.timestamp.getTime()) / 1000),
        } : null,
      },
      milestones: {
        minSeq: milestoneAggregates.minSeq?.toString() ?? null,
        maxSeq: milestoneAggregates.maxSeq?.toString() ?? null,
        minStartBlock: milestoneAggregates.minStartBlock?.toString() ?? null,
        maxEndBlock: milestoneAggregates.maxEndBlock?.toString() ?? null,
        minTimestamp: milestoneAggregates.minTimestamp ?? null,
        maxTimestamp: milestoneAggregates.maxTimestamp ?? null,
        total: milestoneAggregates.totalCount?.toString() ?? '0',
        latest: latestMilestone ? {
          sequenceId: latestMilestone.sequence_id.toString(),
          endBlock: latestMilestone.end_block.toString(),
          timestamp: latestMilestone.timestamp.toISOString(),
          age: Math.floor((Date.now() - latestMilestone.timestamp.getTime()) / 1000),
        } : null,
      },
      inflation: {
        rateCount: inflation.inflationCount,
        latestRate: inflation.latestInflation?.interestPerYearLog2 ?? null,
        lastChange: inflation.latestInflation?.blockTimestamp ?? null,
      },
      backfillTargets: {
        blockTarget: parseInt(process.env.BACKFILL_TO_BLOCK || '50000000', 10),
        milestoneTarget: parseInt(process.env.MILESTONE_BACKFILL_TO_SEQUENCE || '1', 10),
      },
      priorityFeeBackfill: priorityFeeBackfillProgress ? {
        cursor: priorityFeeBackfillProgress.cursor,
        minBlock: priorityFeeBackfillProgress.minBlock,
        maxBlock: priorityFeeBackfillProgress.maxBlock,
        processedBlocks: priorityFeeBackfillProgress.processedBlocks,
        totalBlocks: priorityFeeBackfillProgress.totalBlocks,
        isComplete: priorityFeeBackfillProgress.isComplete,
      } : null,
      priorityFeeRecalc: priorityFeeRecalcProgress ? {
        cursor: priorityFeeRecalcProgress.cursor,
        startBlock: priorityFeeRecalcProgress.startBlock,
        targetBlock: priorityFeeRecalcProgress.targetBlock,
        processedBlocks: priorityFeeRecalcProgress.processedBlocks,
        totalBlocks: priorityFeeRecalcProgress.totalBlocks,
        isComplete: priorityFeeRecalcProgress.isComplete,
      } : null,
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
