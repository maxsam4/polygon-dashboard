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
 *
 * Note: All BigInt values must be converted to strings before caching,
 * as JSON serialization (used by unstable_cache) doesn't support BigInt.
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
      coverage: {
        blockCoverage: blockCoverage ? {
          id: blockCoverage.id,
          lowWaterMark: blockCoverage.lowWaterMark.toString(),
          highWaterMark: blockCoverage.highWaterMark.toString(),
          lastAnalyzedAt: blockCoverage.lastAnalyzedAt?.toISOString() ?? null,
          updatedAt: blockCoverage.updatedAt.toISOString(),
        } : null,
        milestoneCoverage: milestoneCoverage ? {
          id: milestoneCoverage.id,
          lowWaterMark: milestoneCoverage.lowWaterMark.toString(),
          highWaterMark: milestoneCoverage.highWaterMark.toString(),
          lastAnalyzedAt: milestoneCoverage.lastAnalyzedAt?.toISOString() ?? null,
          updatedAt: milestoneCoverage.updatedAt.toISOString(),
        } : null,
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
        minTimestamp: blockAggregates.minTimestamp ?? null,
        maxTimestamp: blockAggregates.maxTimestamp ?? null,
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
        minTimestamp: milestoneAggregates.minTimestamp ?? null,
        maxTimestamp: milestoneAggregates.maxTimestamp ?? null,
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
          lowWaterMark: coverage.blockCoverage.lowWaterMark,
          highWaterMark: coverage.blockCoverage.highWaterMark,
          lastAnalyzedAt: coverage.blockCoverage.lastAnalyzedAt ?? null,
        } : null,
        milestones: coverage.milestoneCoverage ? {
          lowWaterMark: coverage.milestoneCoverage.lowWaterMark,
          highWaterMark: coverage.milestoneCoverage.highWaterMark,
          lastAnalyzedAt: coverage.milestoneCoverage.lastAnalyzedAt ?? null,
        } : null,
      },
      inflation: {
        rateCount: inflation.inflationCount,
        latestRate: inflation.latestInflation?.interestPerYearLog2 ?? null,
        lastChange: inflation.latestInflation?.blockTimestamp ?? null,
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
