import { getRpcClient, TransactionReceipt } from '../rpc';
import { updateBlockPriorityFeesBatch } from '../queries/blocks';
import { query } from '../db';
import { getIndexerState, updateIndexerState, initializeIndexerState } from './indexerState';
import { getTableStats } from '../queries/stats';
import { sleep } from '../utils';
import { GWEI } from '../constants';

interface PendingBlock {
  blockNumber: bigint;
  timestamp: Date;
  baseFeeGwei: number;
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

const HISTORICAL_SERVICE_NAME = 'historical_priority_fee_backfiller';

/**
 * Historical Priority Fee Backfiller - fills priority fee data for legacy blocks.
 *
 * Processes historical blocks that were inserted before inline receipt enrichment
 * was added. Uses cursor-based pagination to track progress.
 */
export class HistoricalPriorityFeeBackfiller {
  private cursor: bigint | null = null; // Current block being processed (works downward)
  private running = false;
  private batchSize: number;
  private delayMs: number;
  private targetBlock: bigint;

  constructor() {
    this.batchSize = parseInt(process.env.HISTORICAL_PRIORITY_FEE_BATCH_SIZE || '100', 10);
    this.delayMs = parseInt(process.env.HISTORICAL_PRIORITY_FEE_DELAY_MS || '100', 10);
    this.targetBlock = BigInt(process.env.BACKFILL_TO_BLOCK || '50000000');
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`[HistoricalPriorityFeeBackfiller] Starting historical priority fee backfiller`);
    console.log(`[HistoricalPriorityFeeBackfiller] Target block: ${this.targetBlock}, Batch size: ${this.batchSize}, Delay: ${this.delayMs}ms`);

    // Load cursor from DB
    const state = await getIndexerState(HISTORICAL_SERVICE_NAME);

    if (state) {
      this.cursor = state.blockNumber;
      console.log(`[HistoricalPriorityFeeBackfiller] Resumed from block #${this.cursor}`);
    } else {
      // Start from the highest block in DB
      const stats = await getTableStats('blocks');
      if (stats?.maxValue) {
        this.cursor = stats.maxValue;
        await initializeIndexerState(HISTORICAL_SERVICE_NAME, this.cursor, '0x0');
        console.log(`[HistoricalPriorityFeeBackfiller] Starting from block #${this.cursor}`);
      } else {
        console.log(`[HistoricalPriorityFeeBackfiller] No blocks in DB yet, waiting...`);
      }
    }

    this.runLoop().catch(error => {
      console.error('[HistoricalPriorityFeeBackfiller] Fatal error:', error);
    });
  }

  stop(): void {
    this.running = false;
    console.log(`[HistoricalPriorityFeeBackfiller] Stopped`);
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        // Retry cursor initialization if not set (handles race condition at startup)
        if (this.cursor === null) {
          const stats = await getTableStats('blocks');
          if (stats?.maxValue) {
            this.cursor = stats.maxValue;
            await initializeIndexerState(HISTORICAL_SERVICE_NAME, this.cursor, '0x0');
            console.log(`[HistoricalPriorityFeeBackfiller] Initialized cursor at block #${this.cursor}`);
          } else {
            await sleep(this.delayMs * 10);  // Wait longer when no data
            continue;
          }
        }

        // Find blocks missing priority fees in the current range
        const blocks = await this.getBlocksMissingPriorityFeesInRange();

        if (blocks.length === 0) {
          // No missing blocks in current range, move cursor down
          if (this.cursor !== null) {
            if (this.cursor <= this.targetBlock) {
              console.log(`[HistoricalPriorityFeeBackfiller] Complete! Reached target block ${this.targetBlock}`);
              this.running = false;
              break;
            }

            // Move cursor down
            this.cursor = this.cursor - BigInt(this.batchSize * 10);
            if (this.cursor < this.targetBlock) this.cursor = this.targetBlock;
            await updateIndexerState(HISTORICAL_SERVICE_NAME, this.cursor, '0x0');
          }
          await sleep(this.delayMs);
          continue;
        }

        // Process the batch
        await this.processBatch(blocks);

        // Update cursor to lowest processed block
        const lowestBlock = blocks.reduce((min, b) => b.blockNumber < min ? b.blockNumber : min, blocks[0].blockNumber);
        this.cursor = lowestBlock;
        await updateIndexerState(HISTORICAL_SERVICE_NAME, this.cursor, '0x0');

        // Delay between batches to not overwhelm RPC
        await sleep(this.delayMs);
      } catch (error) {
        console.error('[HistoricalPriorityFeeBackfiller] Error:', error);
        await sleep(this.delayMs * 5);
      }
    }
  }

  /**
   * Find blocks missing priority fees in the current cursor range.
   */
  private async getBlocksMissingPriorityFeesInRange(): Promise<PendingBlock[]> {
    if (this.cursor === null) return [];

    const rangeStart = this.cursor - BigInt(this.batchSize * 10);
    const rangeEnd = this.cursor;

    const rows = await query<{
      block_number: string;
      timestamp: Date;
      base_fee_gwei: number;
    }>(
      `SELECT block_number, timestamp, base_fee_gwei
       FROM blocks
       WHERE block_number >= $1 AND block_number <= $2
         AND (avg_priority_fee_gwei IS NULL OR total_priority_fee_gwei IS NULL)
         AND tx_count > 0
       ORDER BY block_number DESC
       LIMIT $3`,
      [rangeStart.toString(), rangeEnd.toString(), this.batchSize]
    );

    return rows.map(row => ({
      blockNumber: BigInt(row.block_number),
      timestamp: row.timestamp,
      baseFeeGwei: row.base_fee_gwei,
    }));
  }

  /**
   * Process a batch of blocks.
   */
  private async processBatch(blocks: PendingBlock[]): Promise<void> {
    const rpc = getRpcClient();
    const blockNumbers = blocks.map(b => b.blockNumber);

    // Fetch receipts for all blocks in parallel
    const receiptsMap = await rpc.getBlocksReceipts(blockNumbers);

    // Calculate metrics and prepare updates
    const updates: Array<{
      block: PendingBlock;
      metrics: ReturnType<typeof calculatePriorityFeeMetrics>;
    }> = [];

    for (const block of blocks) {
      const receipts = receiptsMap.get(block.blockNumber);
      if (!receipts || receipts.length === 0) continue;

      const metrics = calculatePriorityFeeMetrics(receipts, block.baseFeeGwei);

      if (metrics.avgPriorityFeeGwei !== null && metrics.totalPriorityFeeGwei !== null) {
        updates.push({ block, metrics });
      }
    }

    // Execute batch DB update (single query instead of N parallel queries)
    await updateBlockPriorityFeesBatch(
      updates.map(({ block, metrics }) => ({
        blockNumber: block.blockNumber,
        timestamp: block.timestamp,
        minPriorityFeeGwei: metrics.minPriorityFeeGwei,
        maxPriorityFeeGwei: metrics.maxPriorityFeeGwei,
        avgPriorityFeeGwei: metrics.avgPriorityFeeGwei!,
        medianPriorityFeeGwei: metrics.medianPriorityFeeGwei,
        totalPriorityFeeGwei: metrics.totalPriorityFeeGwei!,
      }))
    );

    if (updates.length > 0) {
      const minBlock = blocks.reduce((min, b) => b.blockNumber < min ? b.blockNumber : min, blocks[0].blockNumber);
      const maxBlock = blocks.reduce((max, b) => b.blockNumber > max ? b.blockNumber : max, blocks[0].blockNumber);
      console.log(`[HistoricalPriorityFeeBackfiller] Updated ${updates.length} blocks (${minBlock}-${maxBlock})`);
    }
  }
}

// Singleton instance for historical backfiller
let historicalBackfillerInstance: HistoricalPriorityFeeBackfiller | null = null;

/**
 * Get the singleton HistoricalPriorityFeeBackfiller instance.
 */
export function getHistoricalPriorityFeeBackfiller(): HistoricalPriorityFeeBackfiller {
  if (!historicalBackfillerInstance) {
    historicalBackfillerInstance = new HistoricalPriorityFeeBackfiller();
  }
  return historicalBackfillerInstance;
}
