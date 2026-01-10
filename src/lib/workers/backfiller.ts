import { getRpcClient, RpcExhaustedError } from '@/lib/rpc';
import { getHeimdallClient } from '@/lib/heimdall';
import { calculateBlockMetrics } from '@/lib/gas';
import {
  getLowestBlockNumber,
  insertBlocksBatch
} from '@/lib/queries/blocks';
import {
  getMilestoneForBlock,
  insertMilestone
} from '@/lib/queries/milestones';
import { Block } from '@/lib/types';

const EXHAUSTED_RETRY_MS = 5 * 60 * 1000; // 5 minutes

export class Backfiller {
  private running = false;
  private targetBlock: bigint;
  private batchSize: number;
  private delayMs: number;

  constructor(targetBlock: bigint, batchSize = 100, delayMs = 100) {
    this.targetBlock = targetBlock;
    this.batchSize = batchSize;
    this.delayMs = delayMs;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`[Backfiller] Starting backfill to block ${this.targetBlock}`);
    await this.backfill();
  }

  stop(): void {
    this.running = false;
  }

  private async backfill(): Promise<void> {
    while (this.running) {
      try {
        const lowestBlock = await getLowestBlockNumber();

        if (lowestBlock === null) {
          // No blocks yet, wait for live poller to add some
          console.log('[Backfiller] No blocks in DB yet, waiting...');
          await this.sleep(5000);
          continue;
        }

        if (lowestBlock <= this.targetBlock) {
          console.log('[Backfiller] Backfill complete!');
          this.running = false;
          return;
        }

        await this.processBatch(lowestBlock);
        await this.sleep(this.delayMs);
      } catch (error) {
        if (error instanceof RpcExhaustedError) {
          console.error('[Backfiller] RPC exhausted, waiting 5 minutes...');
          await this.sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[Backfiller] Error:', error);
          await this.sleep(5000);
        }
      }
    }
  }

  private async processBatch(currentLowest: bigint): Promise<void> {
    const rpc = getRpcClient();
    const heimdall = getHeimdallClient();

    const startBlock = currentLowest - BigInt(this.batchSize);
    const endBlock = currentLowest - 1n;
    const targetStart = startBlock < this.targetBlock ? this.targetBlock : startBlock;

    console.log(`[Backfiller] Processing blocks ${targetStart} to ${endBlock}`);

    const blocks: Omit<Block, 'createdAt' | 'updatedAt'>[] = [];

    for (let blockNum = endBlock; blockNum >= targetStart; blockNum--) {
      const block = await rpc.getBlockWithTransactions(blockNum);

      // Get previous block for block time calculation
      let previousTimestamp: bigint | undefined;
      if (blockNum > 0n) {
        const prevBlock = await rpc.getBlock(blockNum - 1n);
        previousTimestamp = prevBlock.timestamp;
      }

      const metrics = calculateBlockMetrics(block, previousTimestamp);

      // Check milestone for finality
      let milestone = await getMilestoneForBlock(blockNum);
      if (!milestone) {
        // Try to fetch from Heimdall
        try {
          const latestMilestone = await heimdall.getLatestMilestone();
          if (blockNum <= latestMilestone.endBlock) {
            await insertMilestone(latestMilestone);
            milestone = latestMilestone;
          }
        } catch {
          // Milestone not available, continue without
        }
      }

      const finalized = milestone ? blockNum <= milestone.endBlock : false;
      let timeToFinalitySec: number | null = null;
      if (finalized && milestone) {
        const blockTime = new Date(Number(block.timestamp) * 1000);
        timeToFinalitySec = (milestone.timestamp.getTime() - blockTime.getTime()) / 1000;
      }

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
        totalBaseFeeGwei: metrics.totalBaseFeeGwei,
        totalPriorityFeeGwei: metrics.totalPriorityFeeGwei,
        txCount: block.transactions.length,
        blockTimeSec: metrics.blockTimeSec,
        mgasPerSec: metrics.mgasPerSec,
        tps: metrics.tps,
        finalized,
        finalizedAt: finalized && milestone ? milestone.timestamp : null,
        milestoneId: finalized && milestone ? milestone.milestoneId : null,
        timeToFinalitySec,
      });
    }

    await insertBlocksBatch(blocks);
    console.log(`[Backfiller] Inserted ${blocks.length} blocks`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
