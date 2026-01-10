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

const POLL_INTERVAL_MS = 2000;
const EXHAUSTED_RETRY_MS = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = parseInt(process.env.LIVE_POLLER_BATCH_SIZE ?? '100', 10);
const CATCHUP_BATCH_SIZE = parseInt(process.env.LIVE_POLLER_CATCHUP_BATCH_SIZE ?? '50', 10);

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
        await sleep(POLL_INTERVAL_MS);
      } catch (error) {
        if (error instanceof RpcExhaustedError) {
          console.error('[LivePoller] RPC exhausted, waiting 5 minutes...');
          await sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[LivePoller] Error:', error);
          await sleep(POLL_INTERVAL_MS);
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

    const blocksToProcess = latestBlockNumber - this.lastProcessedBlock;

    if (blocksToProcess <= 0n) {
      return;
    }

    // If we're more than BATCH_SIZE blocks behind, use batch processing
    if (blocksToProcess > BigInt(BATCH_SIZE)) {
      await this.processBatch(latestBlockNumber);
    } else {
      // Process blocks sequentially when at tip
      for (let blockNum = this.lastProcessedBlock + 1n; blockNum <= latestBlockNumber; blockNum++) {
        await this.processBlock(blockNum);
        this.lastProcessedBlock = blockNum;
      }
    }
  }

  private async processBatch(latestBlockNumber: bigint): Promise<void> {
    const startBlock = this.lastProcessedBlock! + 1n;
    const endBlock = startBlock + BigInt(CATCHUP_BATCH_SIZE) - 1n;
    const targetBlock = endBlock < latestBlockNumber ? endBlock : latestBlockNumber;
    const blocksToFetch = Number(targetBlock - startBlock) + 1;

    console.log(`[LivePoller] Catching up: processing blocks ${startBlock} to ${targetBlock} (${blocksToFetch} blocks, ${latestBlockNumber - targetBlock} behind)`);

    const rpc = getRpcClient();
    const blocks: Omit<Block, 'createdAt' | 'updatedAt'>[] = [];

    // Fetch blocks in parallel
    const blockNumbers = Array.from(
      { length: blocksToFetch },
      (_, i) => startBlock + BigInt(i)
    );

    // Process in smaller parallel batches to avoid overwhelming RPC
    const parallelBatchSize = 10;
    for (let i = 0; i < blockNumbers.length; i += parallelBatchSize) {
      const batch = blockNumbers.slice(i, i + parallelBatchSize);

      const blockPromises = batch.map(async (blockNumber) => {
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
        } catch (error) {
          console.error(`[LivePoller] Error fetching block ${blockNumber}:`, error);
          return null;
        }
      });

      const results = await Promise.all(blockPromises);
      blocks.push(...results.filter((b): b is NonNullable<typeof b> => b !== null));
    }

    if (blocks.length > 0) {
      // Sort by block number to ensure correct order
      blocks.sort((a, b) => Number(a.blockNumber - b.blockNumber));
      await insertBlocksBatch(blocks);
      this.lastProcessedBlock = blocks[blocks.length - 1].blockNumber;
      console.log(`[LivePoller] Batch inserted ${blocks.length} blocks, now at ${this.lastProcessedBlock}`);
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
