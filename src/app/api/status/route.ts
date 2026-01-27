import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { areWorkersRunning, getAllWorkerStatuses } from '@/lib/workers';
import { getPendingGaps, getGapStats, getDataCoverage } from '@/lib/queries/gaps';
import { getInflationRateCount, getLatestInflationRate } from '@/lib/queries/inflation';
import {
  getBlockAggregates,
  getMilestoneAggregates,
  getLatestBlock,
  getLatestMilestone,
} from '@/lib/queries/aggregates';
import { getPriorityFeeFixStatus } from '@/lib/workers/priorityFeeFixer';

export const dynamic = 'force-dynamic';

/**
 * Cached aggregates: block/milestone stats, coverage, inflation
 * Cache for 10 seconds to reduce load on compressed chunks
 */
const getCachedAggregates = unstable_cache(
  async () => {
    const [blockAggregates, milestoneAggregates, blockCoverage, milestoneCoverage, inflationCount, latestInflation] =
      await Promise.all([
        getBlockAggregates(),
        getMilestoneAggregates(),
        getDataCoverage('blocks'),
        getDataCoverage('milestones'),
        getInflationRateCount().catch(() => 0),
        getLatestInflationRate().catch(() => null),
      ]);

    return {
      blockAggregates,
      milestoneAggregates,
      coverage: { blockCoverage, milestoneCoverage },
      inflation: { inflationCount, latestInflation },
    };
  },
  ['status-aggregates'],
  { revalidate: 10 }
);

export async function GET() {
  try {
    // Fetch cached aggregates (slow-changing data)
    const aggregates = await getCachedAggregates();
    const { blockAggregates, milestoneAggregates, coverage, inflation } = aggregates;

    // Fetch real-time data (fast queries, not cached)
    const [blockGaps, milestoneGaps, finalityGaps, blockGapStats, milestoneGapStats, finalityGapStats, latestBlock, latestMilestone, priorityFeeFixStatus] =
      await Promise.all([
        getPendingGaps('block', 20),
        getPendingGaps('milestone', 20),
        getPendingGaps('finality', 20),
        getGapStats('block'),
        getGapStats('milestone'),
        getGapStats('finality'),
        getLatestBlock(),
        getLatestMilestone(),
        getPriorityFeeFixStatus().catch(() => null),
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
        minTimestamp: blockAggregates.minTimestamp?.toISOString() ?? null,
        maxTimestamp: blockAggregates.maxTimestamp?.toISOString() ?? null,
        total: blockAggregates.totalCount?.toString() ?? '0',
        finalized: blockAggregates.finalizedCount?.toString() ?? '0',
        minFinalized: blockAggregates.minFinalized?.toString() ?? null,
        maxFinalized: blockAggregates.maxFinalized?.toString() ?? null,
        gaps: blockGaps.map(g => ({
          start: g.startValue.toString(),
          end: g.endValue.toString(),
          size: g.gapSize,
          source: g.source,
          createdAt: g.createdAt.toISOString(),
        })),
        gapStats: blockGapStats,
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
        minTimestamp: milestoneAggregates.minTimestamp?.toISOString() ?? null,
        maxTimestamp: milestoneAggregates.maxTimestamp?.toISOString() ?? null,
        total: milestoneAggregates.totalCount?.toString() ?? '0',
        gaps: milestoneGaps.map(g => ({
          start: g.startValue.toString(),
          end: g.endValue.toString(),
          size: g.gapSize,
          source: g.source,
          createdAt: g.createdAt.toISOString(),
        })),
        gapStats: milestoneGapStats,
        latest: latestMilestone ? {
          sequenceId: latestMilestone.sequence_id.toString(),
          endBlock: latestMilestone.end_block.toString(),
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
        blocks: coverage.blockCoverage ? {
          lowWaterMark: coverage.blockCoverage.lowWaterMark.toString(),
          highWaterMark: coverage.blockCoverage.highWaterMark.toString(),
          lastAnalyzedAt: coverage.blockCoverage.lastAnalyzedAt?.toISOString() ?? null,
        } : null,
        milestones: coverage.milestoneCoverage ? {
          lowWaterMark: coverage.milestoneCoverage.lowWaterMark.toString(),
          highWaterMark: coverage.milestoneCoverage.highWaterMark.toString(),
          lastAnalyzedAt: coverage.milestoneCoverage.lastAnalyzedAt?.toISOString() ?? null,
        } : null,
      },
      inflation: {
        rateCount: inflation.inflationCount,
        latestRate: inflation.latestInflation?.interestPerYearLog2.toString() ?? null,
        lastChange: inflation.latestInflation?.blockTimestamp.toISOString() ?? null,
      },
      priorityFeeFix: priorityFeeFixStatus ? {
        fixDeployedAtBlock: priorityFeeFixStatus.fixDeployedAtBlock?.toString() ?? null,
        lastFixedBlock: priorityFeeFixStatus.lastFixedBlock?.toString() ?? null,
        earliestBlock: priorityFeeFixStatus.earliestBlock?.toString() ?? null,
        totalToFix: priorityFeeFixStatus.totalToFix.toString(),
        totalFixed: priorityFeeFixStatus.totalFixed.toString(),
        percentComplete: priorityFeeFixStatus.percentComplete,
        isComplete: priorityFeeFixStatus.isComplete,
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
