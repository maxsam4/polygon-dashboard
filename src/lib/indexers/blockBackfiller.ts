import { getRpcClient } from '../rpc';
import { insertBlocksBatch, getLowestBlockNumber } from '../queries/blocks';
import { calculateBlockMetrics, deriveGasTargetPct } from '../gas';
import { Block } from '../types';
import { getIndexerState, updateIndexerState, initializeIndexerState } from './indexerState';
import { applyReceiptsToBlocks } from './receiptEnricher';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from '../workers/workerStatus';
import { sleep } from '../utils';
import { updateTableStats } from '../queries/stats';
import { Eip1559Param, getBfcdForBlock, getDefaultGasTargetPct, KNOWN_EIP1559_PARAMS } from '../eip1559Params';
import { getAllEip1559Params } from '../queries/eip1559Params';

const SERVICE_NAME = 'block_backfiller';
const WORKER_NAME = 'BlockBackfiller';
const PARAM_RELOAD_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

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
  private abortController: AbortController | null = null;
  private batchSize: number;
  private delayMs: number;
  private eip1559Params: Eip1559Param[] = [];
  private lastParamReload: number = 0;

  constructor() {
    this.targetBlock = BigInt(process.env.BACKFILL_TO_BLOCK || '50000000');
    this.batchSize = parseInt(process.env.BACKFILL_BATCH_SIZE || '10', 10);
    this.delayMs = parseInt(process.env.BACKFILL_DELAY_MS || '100', 10);
  }

  /**
   * Start the block backfiller.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.abortController = new AbortController();

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

    // Load EIP-1559 params for gas target derivation
    await this.loadEip1559Params();

    // Check if already complete
    if (this.cursor !== null && this.cursor <= this.targetBlock) {
      console.log(`[${WORKER_NAME}] Backfill already complete! (lowest=${this.cursor}, target=${this.targetBlock})`);
      updateWorkerState(WORKER_NAME, 'idle');
      return;
    }

    // Start main loop
    this.runLoop().catch(err => {
      console.error(`[${WORKER_NAME}] runLoop exited with error:`, err);
      updateWorkerError(WORKER_NAME, err instanceof Error ? err.message : String(err));
    });
  }

  /**
   * Stop the block backfiller.
   */
  stop(): void {
    this.abortController?.abort();
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
        // Periodically reload EIP-1559 params to pick up admin changes
        if (Date.now() - this.lastParamReload > PARAM_RELOAD_INTERVAL_MS) {
          await this.loadEip1559Params();
        }

        // Calculate block range to fetch (going backwards)
        const endBlock = this.cursor! - 1n;
        const startBlockRaw = endBlock - BigInt(this.batchSize) + 1n;
        const startBlock = startBlockRaw < this.targetBlock ? this.targetBlock : startBlockRaw;

        // Fetch blocks (include one extra block before startBlock for timestamp calculation)
        const fetchStart = startBlock > 0n ? startBlock - 1n : startBlock;
        const blockNumbers = this.range(fetchStart, endBlock);
        const insertBlockNumbers = this.range(startBlock, endBlock);
        const rpc = getRpcClient();

        // Fetch blocks and receipts in parallel
        const [blocksMap, receiptsMap] = await Promise.all([
          rpc.getBlocksWithTransactions(blockNumbers),
          rpc.getBlocksReceiptsReliably(insertBlockNumbers, this.abortController!.signal),
        ]);

        // Sort blocks by number (ascending for processing)
        const allBlocks = Array.from(blocksMap.values()).sort(
          (a, b) => Number(a.number - b.number)
        );

        if (allBlocks.length === 0) {
          console.warn(`[${WORKER_NAME}] No blocks returned for range ${startBlock}-${endBlock}`);
          await sleep(this.delayMs);
          continue;
        }

        // Separate the extra block (for timestamp + gas target derivation) from blocks to insert
        const extraBlock = fetchStart < startBlock && allBlocks[0].number === fetchStart
          ? allBlocks[0]
          : undefined;
        const prevBlockTimestamp = extraBlock?.timestamp;
        const blocks = allBlocks.filter(b => b.number >= startBlock);

        if (blocks.length === 0) {
          console.warn(`[${WORKER_NAME}] No blocks to insert for range ${startBlock}-${endBlock}`);
          await sleep(this.delayMs);
          continue;
        }

        // Convert blocks
        const blockData = await this.convertBlocks(blocks, prevBlockTimestamp, extraBlock);

        // Apply pre-fetched receipts to compute priority fee metrics
        const { enrichedCount } = applyReceiptsToBlocks(blockData, receiptsMap);

        // Insert complete blocks
        await insertBlocksBatch(blockData);

        // Update cursor to the lowest block we just processed
        const lowestBlock = blocks[0];
        await updateIndexerState(SERVICE_NAME, lowestBlock.number, lowestBlock.hash);
        this.cursor = lowestBlock.number;

        // Update table stats for API queries
        const highestBlock = blocks[blocks.length - 1];
        await updateTableStats('blocks', lowestBlock.number, highestBlock.number, blocks.length);

        updateWorkerRun(WORKER_NAME, blocks.length);

        const remaining = this.cursor - this.targetBlock;
        console.log(`[${WORKER_NAME}] Backfilled ${blocks.length} blocks (${startBlock}-${endBlock}), ${enrichedCount} enriched, remaining: ${remaining}`);

        // Small delay to avoid overwhelming the RPC
        await sleep(this.delayMs);
      } catch (error) {
        if (!this.running) break; // Clean abort exit
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[${WORKER_NAME}] Error:`, errorMsg);
        updateWorkerError(WORKER_NAME, errorMsg);
        await sleep(this.delayMs * 10); // Longer delay on error
      }
    }

    if (this.cursor !== null && this.cursor <= this.targetBlock) {
      console.log(`[${WORKER_NAME}] Backfill complete! Reached target block ${this.targetBlock}`);
      updateWorkerState(WORKER_NAME, 'idle');
    }
  }

  /**
   * Load EIP-1559 params from DB, falling back to hardcoded values.
   */
  private async loadEip1559Params(): Promise<void> {
    try {
      const dbParams = await getAllEip1559Params();
      if (dbParams.length > 0) {
        this.eip1559Params = dbParams.map(p => ({
          blockNumber: p.blockNumber,
          baseFeeChangeDenominator: p.baseFeeChangeDenominator,
        }));
        console.log(`[${WORKER_NAME}] Loaded ${dbParams.length} EIP-1559 params from DB`);
        this.lastParamReload = Date.now();
        return;
      }
    } catch {
      // DB may not have the table yet
    }
    this.eip1559Params = KNOWN_EIP1559_PARAMS.map(p => ({
      blockNumber: p.blockNumber,
      baseFeeChangeDenominator: p.baseFeeChangeDenominator,
    }));
    console.log(`[${WORKER_NAME}] Using ${this.eip1559Params.length} hardcoded EIP-1559 params`);
    this.lastParamReload = Date.now();
  }

  /**
   * Convert viem blocks to our Block type.
   * @param blocks - Array of blocks to convert
   * @param prevBlockTimestamp - Timestamp of the block before the first block (for block_time calculation)
   * @param extraBlock - The extra block fetched before the batch (for gas target derivation of first block)
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
    }>,
    prevBlockTimestamp?: bigint,
    extraBlock?: {
      number: bigint;
      gasUsed: bigint;
      gasLimit: bigint;
      baseFeePerGas: bigint | null | undefined;
    }
  ): Promise<Block[]> {
    const result: Block[] = [];
    let lastGasTargetPct: number | null = null;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      // Use previous block in batch, or the provided prevBlockTimestamp for first block
      const previousTimestamp = i > 0 ? blocks[i - 1].timestamp : prevBlockTimestamp;

      const metrics = calculateBlockMetrics(
        {
          baseFeePerGas: block.baseFeePerGas ?? null,
          gasUsed: block.gasUsed,
          timestamp: block.timestamp,
          transactions: block.transactions,
        },
        previousTimestamp
      );

      // Derive gas target percentage using parent block data
      let gasTargetPct: number | null = null;
      if (i > 0) {
        const parent = blocks[i - 1];
        const bfcd = getBfcdForBlock(block.number, this.eip1559Params);
        if (bfcd !== null) {
          const parentBaseFee = Number(parent.baseFeePerGas ?? 0n) / 1e9;
          gasTargetPct = deriveGasTargetPct(
            metrics.baseFeeGwei, parentBaseFee, parent.gasUsed, parent.gasLimit, bfcd
          );
        }
      } else if (extraBlock) {
        // First block in batch - use the extra block as parent
        const bfcd = getBfcdForBlock(block.number, this.eip1559Params);
        if (bfcd !== null) {
          const parentBaseFee = Number(extraBlock.baseFeePerGas ?? 0n) / 1e9;
          gasTargetPct = deriveGasTargetPct(
            metrics.baseFeeGwei, parentBaseFee, extraBlock.gasUsed, extraBlock.gasLimit, bfcd
          );
        }
      }

      // Carry-forward logic
      if (gasTargetPct !== null) {
        lastGasTargetPct = gasTargetPct;
      } else if (lastGasTargetPct !== null) {
        gasTargetPct = lastGasTargetPct;
      } else {
        gasTargetPct = getDefaultGasTargetPct(block.number);
        lastGasTargetPct = gasTargetPct;
      }

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
        gasTargetPct,
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
