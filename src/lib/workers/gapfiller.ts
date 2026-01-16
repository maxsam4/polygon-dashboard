import { getRpcClient, RpcExhaustedError } from '@/lib/rpc';
import { getHeimdallClient, HeimdallExhaustedError } from '@/lib/heimdall';
import { calculateBlockMetrics } from '@/lib/gas';
import { insertBlocksBatch } from '@/lib/queries/blocks';
import { insertMilestonesBatch, reconcileBlocksForMilestones } from '@/lib/queries/milestones';
import {
  getPendingGaps,
  claimGap,
  markGapFilled,
  shrinkGap,
  releaseGap,
  Gap,
} from '@/lib/queries/gaps';
import { Block } from '@/lib/types';
import { sleep } from '@/lib/utils';
import { query } from '@/lib/db';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from './workerStatus';

const WORKER_NAME = 'Gapfiller';
const EXHAUSTED_RETRY_MS = 5000; // 5 seconds
const BASE_BATCH_SIZE = 50; // Base batch size, multiplied by endpoint count (same as Backfiller)
const MILESTONE_CHUNK_SIZE = 50; // Process milestone gaps in larger chunks (parallel fetch)

// Helper to reconcile blocks in a specific range
async function reconcileBlocksInRange(startBlock: bigint, endBlock: bigint): Promise<number> {
  const result = await query<{ count: string }>(
    `WITH updated AS (
      UPDATE blocks b
      SET
        finalized = TRUE,
        finalized_at = m.timestamp,
        milestone_id = m.milestone_id,
        time_to_finality_sec = EXTRACT(EPOCH FROM (m.timestamp - b.timestamp)),
        updated_at = NOW()
      FROM milestones m
      WHERE m.start_block <= $2 AND m.end_block >= $1
        AND b.block_number BETWEEN m.start_block AND m.end_block
        AND b.finalized = FALSE
        AND b.block_number BETWEEN $1 AND $2
      RETURNING 1
    )
    SELECT COUNT(*) as count FROM updated`,
    [startBlock.toString(), endBlock.toString()]
  );
  return parseInt(result[0]?.count ?? '0', 10);
}

export class Gapfiller {
  private running = false;
  private delayMs: number;

  constructor(delayMs = 100) {
    this.delayMs = delayMs;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    initWorkerStatus(WORKER_NAME);
    updateWorkerState(WORKER_NAME, 'running');

    console.log('[Gapfiller] Starting gap filler');
    this.fill();
  }

  stop(): void {
    this.running = false;
    updateWorkerState(WORKER_NAME, 'stopped');
  }

  private async fill(): Promise<void> {
    while (this.running) {
      try {
        updateWorkerState(WORKER_NAME, 'running');
        // Try to fill gaps in priority order: block, milestone, finality
        const filledBlock = await this.fillNextGap('block');
        if (filledBlock) {
          updateWorkerRun(WORKER_NAME, 1);
          await sleep(this.delayMs);
          continue;
        }

        const filledMilestone = await this.fillNextGap('milestone');
        if (filledMilestone) {
          updateWorkerRun(WORKER_NAME, 1);
          await sleep(this.delayMs);
          continue;
        }

        const filledFinality = await this.fillNextGap('finality');
        if (filledFinality) {
          updateWorkerRun(WORKER_NAME, 1);
          await sleep(this.delayMs);
          continue;
        }

        // No gaps to fill, wait before checking again
        updateWorkerState(WORKER_NAME, 'idle');
        await sleep(EXHAUSTED_RETRY_MS);
      } catch (error) {
        if (error instanceof RpcExhaustedError) {
          console.error('[Gapfiller] RPC exhausted, waiting...');
          updateWorkerError(WORKER_NAME, 'RPC exhausted');
          await sleep(EXHAUSTED_RETRY_MS);
        } else if (error instanceof HeimdallExhaustedError) {
          console.error('[Gapfiller] Heimdall exhausted, waiting...');
          updateWorkerError(WORKER_NAME, 'Heimdall exhausted');
          await sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[Gapfiller] Error:', error);
          updateWorkerError(WORKER_NAME, error instanceof Error ? error.message : 'Unknown error');
          await sleep(EXHAUSTED_RETRY_MS);
        }
      }
    }
  }

  private async fillNextGap(gapType: 'block' | 'milestone' | 'finality'): Promise<boolean> {
    // Get pending gaps (ordered by end_value DESC - recent first)
    const gaps = await getPendingGaps(gapType, 1);
    if (gaps.length === 0) {
      return false;
    }

    const gap = gaps[0];

    // Try to claim the gap atomically
    const claimed = await claimGap(gap.id);
    if (!claimed) {
      // Another worker got it, try again
      return false;
    }

    try {
      // Fill the gap based on type
      switch (gapType) {
        case 'block':
          await this.fillBlockGap(gap);
          break;
        case 'milestone':
          await this.fillMilestoneGap(gap);
          break;
        case 'finality':
          await this.fillFinalityGap(gap);
          break;
      }

      return true;
    } catch (error) {
      // Release the gap back to pending so it can be retried
      console.error(`[Gapfiller] Error filling ${gapType} gap ${gap.id}:`, error);
      await releaseGap(gap.id);
      throw error; // Re-throw to trigger wait in main loop
    }
  }

  private async fillBlockGap(gap: Gap): Promise<void> {
    const rpc = getRpcClient();
    const startBlock = gap.startValue;
    const endBlock = gap.endValue;

    // Scale batch size by endpoint count for better parallelism (same as Backfiller)
    const batchSize = BASE_BATCH_SIZE * rpc.endpointCount;

    console.log(`[Gapfiller] Filling block gap ${gap.id}: ${startBlock} to ${endBlock} (batch size: ${batchSize})`);

    // Process in batches
    let currentStart = startBlock;
    while (currentStart <= endBlock && this.running) {
      const batchEnd = currentStart + BigInt(batchSize - 1);
      const actualEnd = batchEnd > endBlock ? endBlock : batchEnd;

      // Build list of block numbers to fetch
      const blockNumbers: bigint[] = [];
      for (let blockNum = currentStart; blockNum <= actualEnd; blockNum++) {
        blockNumbers.push(blockNum);
      }

      // Also need previous blocks for block time calculation
      const prevBlockNumbers = blockNumbers.map(n => n - 1n).filter(n => n >= 0n);

      // Fetch all blocks in parallel using batch methods (same as Backfiller)
      const [blocksMap, prevBlocksMap] = await Promise.all([
        rpc.getBlocksWithTransactions(blockNumbers),
        rpc.getBlocks(prevBlockNumbers),
      ]);

      const blocks: Omit<Block, 'createdAt' | 'updatedAt'>[] = [];

      for (const blockNum of blockNumbers) {
        const block = blocksMap.get(blockNum);
        if (!block) continue;

        // Get previous block timestamp for block time calculation
        let previousTimestamp: bigint | undefined;
        if (blockNum > 0n) {
          const prevBlock = prevBlocksMap.get(blockNum - 1n);
          if (prevBlock) {
            previousTimestamp = prevBlock.timestamp;
          }
        }

        const metrics = calculateBlockMetrics(block, previousTimestamp);

        blocks.push({
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
        });
      }

      if (blocks.length > 0) {
        // Insert blocks - insertBlocksBatch auto-sets finality via LEFT JOIN to milestones
        await insertBlocksBatch(blocks);

        // Shrink the gap (moves start forward)
        const newStart = actualEnd + 1n;
        await shrinkGap(gap.id, newStart, endBlock);

        console.log(`[Gapfiller] Filled ${blocks.length} blocks (${currentStart} to ${actualEnd})`);
      }

      currentStart = actualEnd + 1n;

      // Small delay between batches
      await sleep(this.delayMs);
    }

    // Mark gap as filled
    await markGapFilled(gap.id);
    console.log(`[Gapfiller] Completed block gap ${gap.id}`);
  }

  private async fillMilestoneGap(gap: Gap): Promise<void> {
    const heimdall = getHeimdallClient();
    const startValue = Number(gap.startValue);
    const endValue = Number(gap.endValue);

    console.log(`[Gapfiller] Filling milestone gap ${gap.id}: seq ${startValue} to ${endValue}`);

    // Process in chunks
    let currentStart = startValue;
    while (currentStart <= endValue && this.running) {
      const chunkEnd = Math.min(currentStart + MILESTONE_CHUNK_SIZE - 1, endValue);

      // Build list of sequence IDs to fetch
      const seqIds: number[] = [];
      for (let seqId = currentStart; seqId <= chunkEnd; seqId++) {
        seqIds.push(seqId);
      }

      // Fetch milestones in parallel
      const milestonePromises = seqIds.map(async (seqId) => {
        const milestone = await heimdall.getMilestone(seqId);
        return {
          milestoneId: milestone.milestoneId,
          sequenceId: milestone.sequenceId,
          startBlock: milestone.startBlock,
          endBlock: milestone.endBlock,
          hash: milestone.hash,
          proposer: milestone.proposer,
          timestamp: milestone.timestamp,
        };
      });

      const milestones = await Promise.all(milestonePromises);

      // Insert milestones
      await insertMilestonesBatch(milestones);

      // Try to reconcile blocks for the inserted milestones
      // This may fail if blocks are in compressed TimescaleDB chunks
      try {
        const reconciled = await reconcileBlocksForMilestones(milestones);
        if (reconciled > 0) {
          console.log(`[Gapfiller] Reconciled ${reconciled} blocks for milestones ${currentStart}-${chunkEnd}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('decompression limit')) {
          console.log(`[Gapfiller] Skipping reconcile for milestones ${currentStart}-${chunkEnd} - blocks in compressed chunks`);
        } else {
          throw error;
        }
      }

      // Shrink the gap (moves start forward)
      const newStart = chunkEnd + 1;
      await shrinkGap(gap.id, BigInt(newStart), BigInt(endValue));

      console.log(`[Gapfiller] Filled milestones seq ${currentStart} to ${chunkEnd}`);
      currentStart = newStart;

      // Small delay between chunks
      await sleep(this.delayMs);
    }

    // Mark gap as filled
    await markGapFilled(gap.id);
    console.log(`[Gapfiller] Completed milestone gap ${gap.id}`);
  }

  private async fillFinalityGap(gap: Gap): Promise<void> {
    // Finality gaps are blocks that EXIST but lack finality data
    // No need to fetch from RPC - blocks already in DB
    // Just reconcile finality for the block range
    // NOTE: This may fail for blocks in compressed TimescaleDB chunks (acceptable loss)
    const startBlock = gap.startValue;
    const endBlock = gap.endValue;

    console.log(`[Gapfiller] Filling finality gap ${gap.id}: blocks ${startBlock} to ${endBlock}`);

    try {
      // Reconcile finality for the entire range
      const reconciled = await reconcileBlocksInRange(startBlock, endBlock);
      console.log(`[Gapfiller] Reconciled ${reconciled} blocks for finality gap ${gap.id}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('decompression limit')) {
        // Blocks are in compressed chunks - finality data for these is acceptable loss
        // Mark the gap as filled to prevent infinite retry loops
        console.log(`[Gapfiller] Skipping finality gap ${gap.id} - blocks in compressed chunks`);
      } else {
        throw error;
      }
    }

    // Mark gap as filled
    await markGapFilled(gap.id);
    console.log(`[Gapfiller] Completed finality gap ${gap.id}`);
  }
}
