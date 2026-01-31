import { getRpcClient } from '../rpc';
import { insertBlocksBatch, getLowestBlockNumber } from '../queries/blocks';
import { calculateBlockMetrics } from '../gas';
import { Block } from '../types';
import { getIndexerState, updateIndexerState, initializeIndexerState } from './indexerState';
import { getPriorityFeeBackfiller } from './priorityFeeBackfill';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from '../workers/workerStatus';
import { sleep } from '../utils';

const SERVICE_NAME = 'block_backfiller';
const WORKER_NAME = 'BlockBackfiller';

/**
 * Block Backfiller - Backwards indexing from lowest indexed block to target.
 *
 * Features:
 * - Separate cursor: Independent from forward indexer
 * - Backwards indexing: Works from current lowest block down to target
 * - Uses same block processing as forward indexer
 */
export class BlockBackfiller {
  private cursor: bigint | null = null; // Current lowest indexed block
  private targetBlock: bigint;
  private running = false;
  private batchSize: number;
  private delayMs: number;
  private priorityFeeBackfiller = getPriorityFeeBackfiller();

  constructor() {
    this.targetBlock = BigInt(process.env.BACKFILL_TO_BLOCK || '50000000');
    this.batchSize = parseInt(process.env.BACKFILL_BATCH_SIZE || '100', 10);
    this.delayMs = parseInt(process.env.BACKFILL_DELAY_MS || '100', 10);
  }

  /**
   * Start the block backfiller.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    initWorkerStatus(WORKER_NAME);
    updateWorkerState(WORKER_NAME, 'running');

    console.log(`[${WORKER_NAME}] Starting block backfiller`);
    console.log(`[${WORKER_NAME}] Target block: ${this.targetBlock}, Batch size: ${this.batchSize}`);

    // Load cursor from DB
    const state = await getIndexerState(SERVICE_NAME);

    if (state) {
      this.cursor = state.blockNumber;
      console.log(`[${WORKER_NAME}] Resumed from block #${this.cursor}`);
    } else {
      // Start from lowest block in DB
      const lowestBlock = await getLowestBlockNumber();

      if (lowestBlock !== null) {
        this.cursor = lowestBlock;
        const rpc = getRpcClient();
        const block = await rpc.getBlock(this.cursor);
        await initializeIndexerState(SERVICE_NAME, this.cursor, block.hash);
        console.log(`[${WORKER_NAME}] Initialized from lowest block #${this.cursor}`);
      } else {
        // No blocks in DB yet, wait for forward indexer to start
        console.log(`[${WORKER_NAME}] No blocks in DB yet, waiting...`);
        updateWorkerState(WORKER_NAME, 'idle');
        await this.waitForBlocks();
      }
    }

    // Check if already complete
    if (this.cursor && this.cursor <= this.targetBlock) {
      console.log(`[${WORKER_NAME}] Backfill already complete! (lowest=${this.cursor}, target=${this.targetBlock})`);
      updateWorkerState(WORKER_NAME, 'idle');
      return;
    }

    // Start priority fee backfiller if not already running
    this.priorityFeeBackfiller.start();

    // Start main loop
    this.runLoop();
  }

  /**
   * Stop the block backfiller.
   */
  stop(): void {
    this.running = false;
    updateWorkerState(WORKER_NAME, 'stopped');
    console.log(`[${WORKER_NAME}] Stopped`);
  }

  /**
   * Wait for the forward indexer to populate some blocks.
   */
  private async waitForBlocks(): Promise<void> {
    while (this.running) {
      const lowestBlock = await getLowestBlockNumber();
      if (lowestBlock !== null) {
        this.cursor = lowestBlock;
        const rpc = getRpcClient();
        const block = await rpc.getBlock(this.cursor);
        await initializeIndexerState(SERVICE_NAME, this.cursor, block.hash);
        console.log(`[${WORKER_NAME}] Found blocks, starting from #${this.cursor}`);
        updateWorkerState(WORKER_NAME, 'running');
        return;
      }
      await sleep(5000); // Check every 5 seconds
    }
  }

  /**
   * Main backfilling loop.
   */
  private async runLoop(): Promise<void> {
    while (this.running && this.cursor! > this.targetBlock) {
      try {
        // Calculate block range to fetch (going backwards)
        const endBlock = this.cursor! - 1n;
        const startBlockRaw = endBlock - BigInt(this.batchSize) + 1n;
        const startBlock = startBlockRaw < this.targetBlock ? this.targetBlock : startBlockRaw;

        // Fetch blocks
        const blockNumbers = this.range(startBlock, endBlock);
        const rpc = getRpcClient();
        const blocksMap = await rpc.getBlocksWithTransactions(blockNumbers);

        // Sort blocks by number (ascending for processing)
        const blocks = Array.from(blocksMap.values()).sort(
          (a, b) => Number(a.number - b.number)
        );

        if (blocks.length === 0) {
          console.warn(`[${WORKER_NAME}] No blocks returned for range ${startBlock}-${endBlock}`);
          await sleep(this.delayMs);
          continue;
        }

        // Convert and insert blocks
        const blockData = await this.convertBlocks(blocks);
        await insertBlocksBatch(blockData);

        // Update cursor to the lowest block we just processed
        const lowestBlock = blocks[0];
        await updateIndexerState(SERVICE_NAME, lowestBlock.number, lowestBlock.hash);
        this.cursor = lowestBlock.number;

        // Queue priority fee backfill
        this.priorityFeeBackfiller.enqueueBatch(
          blockData.map(b => ({
            blockNumber: b.blockNumber,
            timestamp: b.timestamp,
            baseFeeGwei: b.baseFeeGwei,
          }))
        );

        updateWorkerRun(WORKER_NAME, blocks.length);

        const remaining = this.cursor - this.targetBlock;
        console.log(`[${WORKER_NAME}] Backfilled ${blocks.length} blocks (${startBlock}-${endBlock}), remaining: ${remaining}`);

        // Small delay to avoid overwhelming the RPC
        await sleep(this.delayMs);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[${WORKER_NAME}] Error:`, errorMsg);
        updateWorkerError(WORKER_NAME, errorMsg);
        await sleep(this.delayMs * 10); // Longer delay on error
      }
    }

    if (this.cursor && this.cursor <= this.targetBlock) {
      console.log(`[${WORKER_NAME}] Backfill complete! Reached target block ${this.targetBlock}`);
      updateWorkerState(WORKER_NAME, 'idle');
    }
  }

  /**
   * Convert viem blocks to our Block type.
   */
  private async convertBlocks(
    blocks: Array<{
      number: bigint;
      hash: `0x${string}`;
      parentHash: `0x${string}`;
      timestamp: bigint;
      gasUsed: bigint;
      gasLimit: bigint;
      baseFeePerGas: bigint | null | undefined;
      transactions: Array<{
        hash: `0x${string}`;
        maxPriorityFeePerGas?: bigint | null;
        gasPrice?: bigint | null;
        gas: bigint;
      }>;
    }>
  ): Promise<Block[]> {
    const result: Block[] = [];

    // For backfilling, we need to fetch previous block timestamps
    // We'll calculate block time based on the next block in our batch
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const previousTimestamp = i > 0 ? blocks[i - 1].timestamp : undefined;

      const metrics = calculateBlockMetrics(
        {
          baseFeePerGas: block.baseFeePerGas ?? null,
          gasUsed: block.gasUsed,
          timestamp: block.timestamp,
          transactions: block.transactions,
        },
        previousTimestamp
      );

      result.push({
        blockNumber: block.number,
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

    return result;
  }

  /**
   * Generate an array of block numbers in a range.
   */
  private range(start: bigint, end: bigint): bigint[] {
    const result: bigint[] = [];
    for (let i = start; i <= end; i++) {
      result.push(i);
    }
    return result;
  }
}

// Singleton instance
let blockBackfillerInstance: BlockBackfiller | null = null;

/**
 * Get the singleton BlockBackfiller instance.
 */
export function getBlockBackfiller(): BlockBackfiller {
  if (!blockBackfillerInstance) {
    blockBackfillerInstance = new BlockBackfiller();
  }
  return blockBackfillerInstance;
}
