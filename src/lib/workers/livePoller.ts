import { getRpcClient, RpcExhaustedError } from '@/lib/rpc';
import { calculateBlockMetrics } from '@/lib/gas';
import {
  getHighestBlockNumber,
  getBlockByNumber,
  insertBlock,
  insertBlocksBatch
} from '@/lib/queries/blocks';
import { Block } from '@/lib/types';
import { sleep } from '@/lib/utils';
import { insertGap } from '@/lib/queries/gaps';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from './workerStatus';

const WORKER_NAME = 'LivePoller';

const POLL_INTERVAL_MS = 2000;
const EXHAUSTED_RETRY_MS = 5000; // 5 seconds - keep trying, don't wait long
const MAX_GAP = 30; // If gap > 30 blocks, skip to latest and let backfiller handle
const BATCH_SIZE = 10; // Process up to 10 blocks at a time when slightly behind

export class LivePoller {
  private running = false;
  private lastProcessedBlock: bigint | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    initWorkerStatus(WORKER_NAME);
    updateWorkerState(WORKER_NAME, 'running');

    // Initialize from database
    this.lastProcessedBlock = await getHighestBlockNumber();
    console.log(`[LivePoller] Starting from block ${this.lastProcessedBlock?.toString() ?? 'none'}`);

    this.poll();
  }

  stop(): void {
    this.running = false;
    updateWorkerState(WORKER_NAME, 'stopped');
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        updateWorkerState(WORKER_NAME, 'running');
        const processed = await this.processNewBlocks();
        if (processed > 0) {
          updateWorkerRun(WORKER_NAME, processed);
        } else {
          updateWorkerState(WORKER_NAME, 'idle');
        }
        await sleep(POLL_INTERVAL_MS);
      } catch (error) {
        if (error instanceof RpcExhaustedError) {
          console.error('[LivePoller] RPC exhausted, waiting 5 minutes...');
          updateWorkerError(WORKER_NAME, 'RPC exhausted');
          await sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[LivePoller] Error:', error);
          updateWorkerError(WORKER_NAME, error instanceof Error ? error.message : 'Unknown error');
          await sleep(POLL_INTERVAL_MS);
        }
      }
    }
  }

  private async processNewBlocks(): Promise<number> {
    const rpc = getRpcClient();
    const latestBlockNumber = await rpc.getLatestBlockNumber();

    if (this.lastProcessedBlock === null) {
      this.lastProcessedBlock = latestBlockNumber - 1n;
    }

    const gap = latestBlockNumber - this.lastProcessedBlock;

    if (gap <= 0n) {
      return 0;
    }

    // If gap is too large, skip to near the tip and let gapfiller handle the gap
    if (gap > BigInt(MAX_GAP)) {
      const skippedFrom = this.lastProcessedBlock + 1n;
      const skippedTo = latestBlockNumber - BigInt(MAX_GAP) - 1n;
      this.lastProcessedBlock = latestBlockNumber - BigInt(MAX_GAP);

      // Record gap for gapfiller
      if (skippedTo >= skippedFrom) {
        await insertGap('block', skippedFrom, skippedTo, 'live_poller');
      }
      console.log(`[LivePoller] Gap too large (${gap} blocks), recorded gap ${skippedFrom}-${skippedTo} for gapfiller`);
    }

    // Process blocks in batches
    const blocksToProcess = Number(latestBlockNumber - this.lastProcessedBlock);
    const batchSize = Math.min(blocksToProcess, BATCH_SIZE);

    if (batchSize > 1) {
      return await this.processBatch(this.lastProcessedBlock + 1n, this.lastProcessedBlock + BigInt(batchSize));
    } else {
      // Process single block
      await this.processBlock(this.lastProcessedBlock + 1n);
      this.lastProcessedBlock = this.lastProcessedBlock + 1n;
      return 1;
    }
  }

  private async processBatch(startBlock: bigint, endBlock: bigint): Promise<number> {
    const blocksToFetch = Number(endBlock - startBlock) + 1;
    const rpc = getRpcClient();
    const blocks: Omit<Block, 'createdAt' | 'updatedAt'>[] = [];

    const blockNumbers = Array.from(
      { length: blocksToFetch },
      (_, i) => startBlock + BigInt(i)
    );

    // Fetch all blocks in parallel
    const blockPromises = blockNumbers.map(async (blockNumber) => {
      try {
        const block = await rpc.getBlockWithTransactions(blockNumber);

        // Get previous block timestamp
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

        const metrics = calculateBlockMetrics(block, previousTimestamp);
        const blockTimestamp = new Date(Number(block.timestamp) * 1000);

        return {
          blockNumber,
          timestamp: blockTimestamp,
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
        };
      } catch {
        console.error(`[LivePoller] Error fetching block ${blockNumber}`);
        return null;
      }
    });

    const results = await Promise.all(blockPromises);
    blocks.push(...results.filter((b): b is NonNullable<typeof b> => b !== null));

    if (blocks.length > 0) {
      blocks.sort((a, b) => Number(a.blockNumber - b.blockNumber));
      await insertBlocksBatch(blocks);
      this.lastProcessedBlock = blocks[blocks.length - 1].blockNumber;
      console.log(`[LivePoller] Inserted ${blocks.length} blocks (${startBlock}-${this.lastProcessedBlock})`);
      return blocks.length;
    }
    return 0;
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
    const blockTimestamp = new Date(Number(block.timestamp) * 1000);

    // Check for reorg
    const existingBlock = await getBlockByNumber(blockNumber);
    if (existingBlock && existingBlock.blockHash !== block.hash) {
      if (existingBlock.finalized) {
        console.error(`[LivePoller] Data discrepancy on finalized block ${blockNumber}! Skipping.`);
        return;
      }
      console.warn(`[LivePoller] Reorg detected at block ${blockNumber}, overwriting.`);
    }

    // Insert/update block - finality is set by the reconciler, not here
    const blockData: Omit<Block, 'createdAt' | 'updatedAt'> = {
      blockNumber,
      timestamp: blockTimestamp,
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
    };

    await insertBlock(blockData);
    console.log(`[LivePoller] Processed block ${blockNumber}`);
  }
}
