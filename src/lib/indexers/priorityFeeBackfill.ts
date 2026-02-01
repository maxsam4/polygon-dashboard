import { getRpcClient, TransactionReceipt } from '../rpc';
import { updateBlockPriorityFees } from '../queries/blocks';
import { query } from '../db';
import { pushBlockUpdate } from '../liveStreamClient';

const GWEI = 1_000_000_000n;

interface PendingBlock {
  blockNumber: bigint;
  timestamp: Date;
  baseFeeGwei: number;
}

/**
 * Queue for backfilling priority fee data after blocks are indexed.
 * This allows the block indexer to insert blocks quickly without waiting
 * for receipt data, then fill in the priority fee metrics asynchronously.
 */
export class PriorityFeeBackfiller {
  private queue: PendingBlock[] = [];
  private processing = false;
  private batchSize: number;
  private running = false;

  constructor(batchSize: number = 10) {
    this.batchSize = batchSize;
  }

  /**
   * Start the backfiller processing loop.
   */
  start(): void {
    this.running = true;
    this.processLoop();
  }

  /**
   * Stop the backfiller.
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Add a block to the backfill queue.
   */
  enqueue(block: PendingBlock): void {
    this.queue.push(block);
  }

  /**
   * Add multiple blocks to the backfill queue.
   */
  enqueueBatch(blocks: PendingBlock[]): void {
    this.queue.push(...blocks);
  }

  /**
   * Get queue status.
   */
  getStatus(): { queueLength: number; processing: boolean } {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
    };
  }

  /**
   * Main processing loop.
   */
  private async processLoop(): Promise<void> {
    while (this.running) {
      if (this.queue.length === 0) {
        // Wait a bit before checking again
        await sleep(100);
        continue;
      }

      this.processing = true;

      try {
        // Get a batch of blocks to process
        const batch = this.queue.splice(0, this.batchSize);
        await this.processBatch(batch);
      } catch (error) {
        console.error('[PriorityFeeBackfiller] Error processing batch:', error);
        // Don't re-queue failed blocks - they can be fixed by a separate process
      }

      this.processing = false;
    }
  }

  /**
   * Process a batch of blocks.
   */
  private async processBatch(blocks: PendingBlock[]): Promise<void> {
    const rpc = getRpcClient();
    const blockNumbers = blocks.map(b => b.blockNumber);

    // Fetch receipts for all blocks in parallel
    const receiptsMap = await rpc.getBlocksReceipts(blockNumbers);

    // Calculate and update priority fees for each block
    for (const block of blocks) {
      const receipts = receiptsMap.get(block.blockNumber);
      if (!receipts || receipts.length === 0) continue;

      const metrics = calculatePriorityFeeMetrics(receipts, block.baseFeeGwei);

      if (metrics.avgPriorityFeeGwei !== null && metrics.totalPriorityFeeGwei !== null) {
        await updateBlockPriorityFees(
          block.blockNumber,
          block.timestamp,
          metrics.minPriorityFeeGwei,
          metrics.maxPriorityFeeGwei,
          metrics.avgPriorityFeeGwei,
          metrics.medianPriorityFeeGwei,
          metrics.totalPriorityFeeGwei
        );

        // Push update to live-stream service (fire-and-forget)
        pushBlockUpdate({
          blockNumber: Number(block.blockNumber),
          minPriorityFeeGwei: metrics.minPriorityFeeGwei,
          maxPriorityFeeGwei: metrics.maxPriorityFeeGwei,
          avgPriorityFeeGwei: metrics.avgPriorityFeeGwei,
          medianPriorityFeeGwei: metrics.medianPriorityFeeGwei,
          totalPriorityFeeGwei: metrics.totalPriorityFeeGwei,
        }).catch(() => {});
      }
    }
  }
}

/**
 * Calculate priority fee metrics from transaction receipts.
 * Uses effectiveGasPrice from receipts for accurate priority fee calculation.
 */
export function calculatePriorityFeeMetrics(
  receipts: TransactionReceipt[],
  baseFeeGwei: number
): {
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  avgPriorityFeeGwei: number | null;
  medianPriorityFeeGwei: number;
  totalPriorityFeeGwei: number | null;
} {
  if (receipts.length === 0) {
    return {
      minPriorityFeeGwei: 0,
      maxPriorityFeeGwei: 0,
      avgPriorityFeeGwei: null,
      medianPriorityFeeGwei: 0,
      totalPriorityFeeGwei: null,
    };
  }

  const baseFeeWei = BigInt(Math.floor(baseFeeGwei * Number(GWEI)));
  let totalPriorityFee = 0n;
  let totalGasUsed = 0n;
  let minPriorityFee = BigInt(Number.MAX_SAFE_INTEGER);
  let maxPriorityFee = 0n;
  const priorityFees: bigint[] = [];

  for (const receipt of receipts) {
    const effectiveGasPrice = receipt.effectiveGasPrice;
    const gasUsed = receipt.gasUsed;

    // Priority fee = effectiveGasPrice - baseFee
    const priorityFeePerGas = effectiveGasPrice > baseFeeWei
      ? effectiveGasPrice - baseFeeWei
      : 0n;

    priorityFees.push(priorityFeePerGas);
    if (priorityFeePerGas < minPriorityFee) minPriorityFee = priorityFeePerGas;
    if (priorityFeePerGas > maxPriorityFee) maxPriorityFee = priorityFeePerGas;

    totalPriorityFee += priorityFeePerGas * gasUsed;
    totalGasUsed += gasUsed;
  }

  // Handle edge case of no receipts
  if (priorityFees.length === 0) {
    minPriorityFee = 0n;
  }

  // Calculate median
  priorityFees.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(priorityFees.length / 2);
  const medianPriorityFee = priorityFees.length % 2 === 0
    ? (priorityFees[mid - 1] + priorityFees[mid]) / 2n
    : priorityFees[mid];

  const totalPriorityFeeGwei = Number(totalPriorityFee) / Number(GWEI);

  // Average priority fee per gas unit
  const avgPriorityFeeGwei = totalGasUsed > 0n
    ? Number(totalPriorityFee / totalGasUsed) / Number(GWEI)
    : 0;

  return {
    minPriorityFeeGwei: Number(minPriorityFee) / Number(GWEI),
    maxPriorityFeeGwei: Number(maxPriorityFee) / Number(GWEI),
    avgPriorityFeeGwei,
    medianPriorityFeeGwei: Number(medianPriorityFee) / Number(GWEI),
    totalPriorityFeeGwei,
  };
}

/**
 * Find blocks that are missing priority fee data and need backfilling.
 */
export async function getBlocksMissingPriorityFees(
  limit: number = 1000
): Promise<PendingBlock[]> {
  // Only check recent blocks (last 24 hours) to avoid scanning compressed chunks
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await query<{
    block_number: string;
    timestamp: Date;
    base_fee_gwei: number;
  }>(
    `SELECT block_number, timestamp, base_fee_gwei
     FROM blocks
     WHERE timestamp >= $1
       AND (avg_priority_fee_gwei IS NULL OR total_priority_fee_gwei IS NULL)
       AND tx_count > 0
     ORDER BY block_number DESC
     LIMIT $2`,
    [oneDayAgo, limit]
  );

  return rows.map(row => ({
    blockNumber: BigInt(row.block_number),
    timestamp: row.timestamp,
    baseFeeGwei: row.base_fee_gwei,
  }));
}

// Singleton instance
let backfillerInstance: PriorityFeeBackfiller | null = null;

/**
 * Get the singleton PriorityFeeBackfiller instance.
 */
export function getPriorityFeeBackfiller(): PriorityFeeBackfiller {
  if (!backfillerInstance) {
    const batchSize = parseInt(process.env.PRIORITY_FEE_BATCH_SIZE || '10', 10);
    backfillerInstance = new PriorityFeeBackfiller(batchSize);
  }
  return backfillerInstance;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
