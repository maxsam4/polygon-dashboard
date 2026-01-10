import { getRpcClient, RpcExhaustedError } from '@/lib/rpc';
import { calculateBlockMetrics } from '@/lib/gas';
import {
  getLowestBlockNumber,
  insertBlocksBatch
} from '@/lib/queries/blocks';
import { Block } from '@/lib/types';
import { sleep } from '@/lib/utils';

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
          await sleep(5000);
          continue;
        }

        if (lowestBlock <= this.targetBlock) {
          console.log('[Backfiller] Backfill complete!');
          this.running = false;
          return;
        }

        await this.processBatch(lowestBlock);
        await sleep(this.delayMs);
      } catch (error) {
        if (error instanceof RpcExhaustedError) {
          console.error('[Backfiller] RPC exhausted, waiting 5 minutes...');
          await sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[Backfiller] Error:', error);
          await sleep(5000);
        }
      }
    }
  }

  private async processBatch(currentLowest: bigint): Promise<void> {
    const rpc = getRpcClient();

    const startBlock = currentLowest - BigInt(this.batchSize);
    const endBlock = currentLowest - 1n;
    const targetStart = startBlock < this.targetBlock ? this.targetBlock : startBlock;

    console.log(`[Backfiller] Processing blocks ${targetStart} to ${endBlock}`);

    const blocks: Omit<Block, 'createdAt' | 'updatedAt'>[] = [];

    // Fetch all blocks in parallel for speed
    const blockNumbers: bigint[] = [];
    for (let blockNum = endBlock; blockNum >= targetStart; blockNum--) {
      blockNumbers.push(blockNum);
    }

    // Process in smaller parallel chunks to avoid overwhelming RPC
    const chunkSize = 10;
    for (let i = 0; i < blockNumbers.length; i += chunkSize) {
      const chunk = blockNumbers.slice(i, i + chunkSize);

      const blockPromises = chunk.map(async (blockNum) => {
        const block = await rpc.getBlockWithTransactions(blockNum);

        // Get previous block for block time calculation
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
          finalized: false, // Will be updated later by milestone poller
          finalizedAt: null,
          milestoneId: null,
          timeToFinalitySec: null,
        };
      });

      const chunkBlocks = await Promise.all(blockPromises);
      blocks.push(...chunkBlocks);
    }

    await insertBlocksBatch(blocks);
    console.log(`[Backfiller] Inserted ${blocks.length} blocks (lowest: ${targetStart})`);
  }
}
