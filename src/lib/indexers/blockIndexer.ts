import { getRpcClient } from '../rpc';
import { insertBlocksBatch, getHighestBlockNumberFromDb } from '../queries/blocks';
import { calculateBlockMetrics } from '../gas';
import { Block } from '../types';
import { getIndexerState, updateIndexerState, initializeIndexerState, IndexerCursor } from './indexerState';
import { handleReorg, getBlockByNumber } from './reorgHandler';
import { enrichBlocksWithReceipts } from './receiptEnricher';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from '../workers/workerStatus';
import { sleep, bigintRange } from '../utils';
import { updateTableStats } from '../queries/stats';
import { checkBlocksForAnomalies } from '../anomalyDetector';

const SERVICE_NAME = 'block_indexer';
const WORKER_NAME = 'BlockIndexer';

/**
 * Block Indexer - Cursor-based, gap-free block indexer with reorg handling.
 *
 * Features:
 * - Cursor-based: Tracks last processed block and hash for reliable resumption
 * - Gap-free: Validates parent hash continuity to ensure no gaps
 * - Reorg-aware: Detects and handles chain reorganizations
 * - Inline receipt enrichment: Fetches receipts before insert for complete data
 */
export class BlockIndexer {
  private cursor: IndexerCursor | null = null;
  private running = false;
  private pollMs: number;
  private batchSize: number;

  constructor() {
    this.pollMs = parseInt(process.env.INDEXER_POLL_MS || '1000', 10);
    this.batchSize = parseInt(process.env.INDEXER_BATCH_SIZE || '10', 10);
  }

  /**
   * Start the block indexer.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    initWorkerStatus(WORKER_NAME);
    updateWorkerState(WORKER_NAME, 'running');

    console.log(`[${WORKER_NAME}] Starting block indexer`);
    console.log(`[${WORKER_NAME}] Poll interval: ${this.pollMs}ms, Batch size: ${this.batchSize}`);

    // Load cursor from DB
    this.cursor = await getIndexerState(SERVICE_NAME);

    if (!this.cursor) {
      // Check if blocks exist in DB first
      const highestBlock = await getHighestBlockNumberFromDb();

      if (highestBlock !== null) {
        // Resume from highest existing block to avoid gaps
        const rpc = getRpcClient();
        const block = await rpc.getBlock(highestBlock);
        await initializeIndexerState(SERVICE_NAME, highestBlock, block.hash);
        this.cursor = { blockNumber: highestBlock, hash: block.hash };
        console.log(`[${WORKER_NAME}] Initialized from highest DB block #${highestBlock}`);
      } else {
        // DB is empty, start from chain tip
        const rpc = getRpcClient();
        const latestBlock = await rpc.getLatestBlockNumber();
        const block = await rpc.getBlock(latestBlock);

        await initializeIndexerState(SERVICE_NAME, latestBlock, block.hash);
        this.cursor = { blockNumber: latestBlock, hash: block.hash };
        console.log(`[${WORKER_NAME}] Initialized cursor at chain tip block #${latestBlock}`);
      }
    } else {
      console.log(`[${WORKER_NAME}] Resumed from block #${this.cursor.blockNumber}`);
    }

    // Start main loop
    this.runLoop();
  }

  /**
   * Stop the block indexer.
   */
  stop(): void {
    this.running = false;
    updateWorkerState(WORKER_NAME, 'stopped');
    console.log(`[${WORKER_NAME}] Stopped`);
  }

  /**
   * Main indexing loop.
   */
  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const rpc = getRpcClient();
        const chainTip = await rpc.getLatestBlockNumber();
        const gap = Number(chainTip - this.cursor!.blockNumber);

        if (gap > 0) {
          // Determine how many blocks to fetch
          const fetchCount = Math.min(gap, this.batchSize);
          const startBlock = this.cursor!.blockNumber + 1n;
          const endBlock = startBlock + BigInt(fetchCount) - 1n;

          // Fetch blocks
          const blockNumbers = bigintRange(startBlock, endBlock);
          const blocksMap = await rpc.getBlocksWithTransactions(blockNumbers);

          // Sort blocks by number to process in order
          const blocks = Array.from(blocksMap.values()).sort(
            (a, b) => Number(a.number - b.number)
          );

          if (blocks.length === 0) {
            console.warn(`[${WORKER_NAME}] No blocks returned for range ${startBlock}-${endBlock}`);
            await sleep(this.pollMs);
            continue;
          }

          // Validate parent hash chain (reorg detection)
          const reorgAt = this.detectReorg(blocks);
          if (reorgAt !== null) {
            console.log(`[${WORKER_NAME}] Reorg detected at block #${reorgAt}`);
            this.cursor = await handleReorg(reorgAt, SERVICE_NAME);
            continue; // Restart loop after reorg handling
          }

          // Convert blocks
          const blockData = await this.convertBlocks(blocks);

          // Enrich with receipt-based priority fees before insert
          const { enrichedCount, failedBlockNumbers } = await enrichBlocksWithReceipts(blockData, { pushToLiveStream: true });
          if (failedBlockNumbers.length > 0) {
            console.warn(`[${WORKER_NAME}] Receipt fetch failed for ${failedBlockNumbers.length} blocks (will be caught by HistoricalPriorityFeeBackfiller)`);
          }

          // Insert complete blocks
          await insertBlocksBatch(blockData);

          // Update cursor
          const lastBlock = blocks[blocks.length - 1];
          await updateIndexerState(SERVICE_NAME, lastBlock.number, lastBlock.hash);
          this.cursor = { blockNumber: lastBlock.number, hash: lastBlock.hash };

          // Update table stats for API queries
          await updateTableStats('blocks', startBlock, lastBlock.number, blocks.length);

          // Check blocks for anomalies (non-blocking)
          checkBlocksForAnomalies(blockData.map(b => ({
            blockNumber: b.blockNumber,
            timestamp: b.timestamp,
            baseFeeGwei: b.baseFeeGwei,
            blockTimeSec: b.blockTimeSec,
            timeToFinalitySec: b.timeToFinalitySec,
            tps: b.tps,
            mgasPerSec: b.mgasPerSec,
          }))).catch(err => {
            console.error(`[${WORKER_NAME}] Anomaly detection error:`, err);
          });

          updateWorkerRun(WORKER_NAME, blocks.length);
          console.log(`[${WORKER_NAME}] Indexed ${blocks.length} blocks (${startBlock}-${lastBlock.number}), ${enrichedCount} enriched with receipts`);
        }

        // Adaptive sleep: faster if behind, slower if caught up
        const sleepMs = gap > 10 ? 100 : this.pollMs;
        await sleep(sleepMs);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[${WORKER_NAME}] Error:`, errorMsg);
        updateWorkerError(WORKER_NAME, errorMsg);
        await sleep(this.pollMs);
      }
    }
  }

  /**
   * Detect reorg by validating parent hash chain.
   * Returns the block number where reorg was detected, or null if chain is valid.
   */
  private detectReorg(
    blocks: Array<{ number: bigint; hash: `0x${string}`; parentHash: `0x${string}` }>
  ): bigint | null {
    // Check first block's parentHash against cursor
    if (blocks[0].parentHash !== this.cursor!.hash) {
      return this.cursor!.blockNumber;
    }

    // Check each subsequent block's parentHash
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i].parentHash !== blocks[i - 1].hash) {
        return blocks[i - 1].number;
      }
    }

    return null;
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
    let previousTimestamp: bigint | undefined;

    // Get the previous block's timestamp for the first block in the batch
    if (blocks.length > 0) {
      const prevBlock = await getBlockByNumber(blocks[0].number - 1n);
      if (prevBlock) {
        previousTimestamp = BigInt(Math.floor(prevBlock.timestamp.getTime() / 1000));
      }
    }

    for (const block of blocks) {
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

      previousTimestamp = block.timestamp;
    }

    return result;
  }
}

// Singleton instance
let blockIndexerInstance: BlockIndexer | null = null;

/**
 * Get the singleton BlockIndexer instance.
 */
export function getBlockIndexer(): BlockIndexer {
  if (!blockIndexerInstance) {
    blockIndexerInstance = new BlockIndexer();
  }
  return blockIndexerInstance;
}
