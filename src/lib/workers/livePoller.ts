import { getRpcClient, RpcExhaustedError } from '@/lib/rpc';
import { calculateBlockMetrics } from '@/lib/gas';
import {
  getHighestBlockNumber,
  getBlockByNumber,
  insertBlock
} from '@/lib/queries/blocks';
import { getLatestMilestone } from '@/lib/queries/milestones';
import { Block } from '@/lib/types';

const POLL_INTERVAL_MS = 2000;
const EXHAUSTED_RETRY_MS = 5 * 60 * 1000; // 5 minutes

export class LivePoller {
  private running = false;
  private lastProcessedBlock: bigint | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Initialize from database
    this.lastProcessedBlock = await getHighestBlockNumber();
    console.log(`[LivePoller] Starting from block ${this.lastProcessedBlock?.toString() ?? 'none'}`);

    this.poll();
  }

  stop(): void {
    this.running = false;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        await this.processNewBlocks();
        await this.sleep(POLL_INTERVAL_MS);
      } catch (error) {
        if (error instanceof RpcExhaustedError) {
          console.error('[LivePoller] RPC exhausted, waiting 5 minutes...');
          await this.sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[LivePoller] Error:', error);
          await this.sleep(POLL_INTERVAL_MS);
        }
      }
    }
  }

  private async processNewBlocks(): Promise<void> {
    const rpc = getRpcClient();
    const latestBlockNumber = await rpc.getLatestBlockNumber();

    if (this.lastProcessedBlock === null) {
      this.lastProcessedBlock = latestBlockNumber - 1n;
    }

    // Process new blocks
    for (let blockNum = this.lastProcessedBlock + 1n; blockNum <= latestBlockNumber; blockNum++) {
      await this.processBlock(blockNum);
      this.lastProcessedBlock = blockNum;
    }
  }

  private async processBlock(blockNumber: bigint): Promise<void> {
    const rpc = getRpcClient();

    // Get block with transactions
    const block = await rpc.getBlockWithTransactions(blockNumber);

    // Get previous block timestamp for block time calculation
    let previousTimestamp: bigint | undefined;
    if (blockNumber > 0n) {
      const prevBlock = await getBlockByNumber(blockNumber - 1n);
      if (prevBlock) {
        previousTimestamp = BigInt(Math.floor(prevBlock.timestamp.getTime() / 1000));
      } else {
        const prevBlockRpc = await rpc.getBlock(blockNumber - 1n);
        previousTimestamp = prevBlockRpc.timestamp;
      }
    }

    // Calculate metrics
    const metrics = calculateBlockMetrics(block, previousTimestamp);

    // Check if block should be marked as finalized
    const latestMilestone = await getLatestMilestone();
    const finalized = latestMilestone ? blockNumber <= latestMilestone.endBlock : false;

    // Check for reorg
    const existingBlock = await getBlockByNumber(blockNumber);
    if (existingBlock && existingBlock.blockHash !== block.hash) {
      if (existingBlock.finalized) {
        console.error(`[LivePoller] Data discrepancy on finalized block ${blockNumber}! Skipping.`);
        return;
      }
      console.warn(`[LivePoller] Reorg detected at block ${blockNumber}, overwriting.`);
    }

    // Insert/update block
    const blockData: Omit<Block, 'createdAt' | 'updatedAt'> = {
      blockNumber,
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
      finalizedAt: finalized && latestMilestone ? latestMilestone.timestamp : null,
      milestoneId: finalized && latestMilestone ? latestMilestone.milestoneId : null,
      timeToFinalitySec: null,
    };

    await insertBlock(blockData);
    console.log(`[LivePoller] Processed block ${blockNumber}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
