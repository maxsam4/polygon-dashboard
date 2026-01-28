import { getRpcClient, TransactionReceipt } from '@/lib/rpc';
import { weiToGwei } from '@/lib/gas';
import { query, queryOne } from '@/lib/db';
import { sleep } from '@/lib/utils';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from './workerStatus';
import { getTableStats } from '@/lib/queries/stats';
import { updateBlocksPriorityFeeBatch, recompressOldChunks } from '@/lib/queries/blocks';

const WORKER_NAME = 'PriorityFeeFixer';

const BATCH_SIZE = 100; // Fixed batch size
const BATCH_DELAY_MS = 100; // Delay between batches

interface PriorityFeeFixStatus {
  fix_deployed_at_block: string;
  last_fixed_block: string | null;
}

export class PriorityFeeFixer {
  private running = false;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    initWorkerStatus(WORKER_NAME);
    updateWorkerState(WORKER_NAME, 'running');

    console.log(`[PriorityFeeFixer] Starting priority fee fix worker`);
    this.run();
  }

  stop(): void {
    this.running = false;
    updateWorkerState(WORKER_NAME, 'stopped');
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        updateWorkerState(WORKER_NAME, 'running');
        console.log('[PriorityFeeFixer] Run loop iteration');

        // Get current fix status
        const status = await queryOne<PriorityFeeFixStatus>(
          `SELECT fix_deployed_at_block, last_fixed_block FROM priority_fee_fix_status WHERE id = 1`
        );

        // If no status row exists or fix_deployed_at_block is 0, initialize it
        if (!status || status.fix_deployed_at_block === '0') {
          const stats = await getTableStats('blocks');
          if (!stats) {
            console.log('[PriorityFeeFixer] No blocks in DB yet, waiting...');
            updateWorkerState(WORKER_NAME, 'idle');
            await sleep(10000);
            continue;
          }

          const currentMaxBlock = stats.maxValue;
          await query(
            `INSERT INTO priority_fee_fix_status (id, fix_deployed_at_block, last_fixed_block, updated_at)
             VALUES (1, $1, $1, NOW())
             ON CONFLICT (id) DO UPDATE SET
               fix_deployed_at_block = CASE WHEN priority_fee_fix_status.fix_deployed_at_block = 0 THEN $1 ELSE priority_fee_fix_status.fix_deployed_at_block END,
               last_fixed_block = CASE WHEN priority_fee_fix_status.last_fixed_block IS NULL THEN $1 ELSE priority_fee_fix_status.last_fixed_block END,
               updated_at = NOW()`,
            [currentMaxBlock.toString()]
          );

          console.log(`[PriorityFeeFixer] Initialized fix tracking at block ${currentMaxBlock}`);
          continue;
        }

        const fixDeployedAt = BigInt(status.fix_deployed_at_block);
        const lastFixed = status.last_fixed_block ? BigInt(status.last_fixed_block) : fixDeployedAt;
        console.log(`[PriorityFeeFixer] Status: fixDeployedAt=${fixDeployedAt}, lastFixed=${lastFixed}`);

        // Get the earliest block in our database
        const stats = await getTableStats('blocks');
        if (!stats) {
          console.log('[PriorityFeeFixer] No blocks in DB, waiting...');
          updateWorkerState(WORKER_NAME, 'idle');
          await sleep(10000);
          continue;
        }

        const earliestBlock = stats.minValue;

        // Check if we've completed the fix
        if (lastFixed <= earliestBlock) {
          console.log(`[PriorityFeeFixer] Fix complete! All blocks from ${earliestBlock} to ${fixDeployedAt} have been fixed.`);

          // Recompress old chunks now that the fix is complete
          try {
            console.log(`[PriorityFeeFixer] Recompressing old chunks...`);
            const recompressedCount = await recompressOldChunks();
            if (recompressedCount > 0) {
              console.log(`[PriorityFeeFixer] Recompressed ${recompressedCount} chunks`);
            }
          } catch (error) {
            console.error(`[PriorityFeeFixer] Failed to recompress chunks:`, error);
          }

          updateWorkerState(WORKER_NAME, 'idle');
          await sleep(60000); // Check once per minute if new blocks appear below
          continue;
        }

        // Process a batch of blocks going backwards
        const batchEnd = lastFixed - 1n;
        const batchStart = batchEnd - BigInt(BATCH_SIZE) + 1n;
        const effectiveStart = batchStart < earliestBlock ? earliestBlock : batchStart;

        const { count, lowestProcessed } = await this.processBatch(effectiveStart, batchEnd);

        if (count > 0 && lowestProcessed !== null) {
          // Update last_fixed_block to the lowest block we successfully fixed
          await query(
            `UPDATE priority_fee_fix_status SET last_fixed_block = $1, updated_at = NOW() WHERE id = 1`,
            [lowestProcessed.toString()]
          );
          updateWorkerRun(WORKER_NAME, count);
          console.log(`[PriorityFeeFixer] Fixed ${count} blocks (${effectiveStart}-${batchEnd}), progress: ${lowestProcessed} -> ${earliestBlock}`);
        } else if (count === 0) {
          // All blocks in batch failed - apply a longer delay before retrying
          console.warn(`[PriorityFeeFixer] Batch ${effectiveStart}-${batchEnd} had no successful updates, retrying...`);
          await sleep(5000);
        }

        await sleep(BATCH_DELAY_MS);
      } catch (error) {
        // This catch is for unexpected errors (DB errors, etc.)
        // RPC errors are now handled per-block in processBatch
        console.error('[PriorityFeeFixer] Error:', error);
        updateWorkerError(WORKER_NAME, error instanceof Error ? error.message : 'Unknown error');
        await sleep(10000);
      }
    }
  }

  /**
   * Process a batch of blocks in parallel.
   * Only fetches block headers (for baseFeePerGas) and receipts (for effectiveGasPrice and gasUsed).
   */
  private async processBatch(startBlock: bigint, endBlock: bigint): Promise<{ count: number; lowestProcessed: bigint | null }> {
    const rpc = getRpcClient();
    const blockNumbers: bigint[] = [];
    for (let blockNum = startBlock; blockNum <= endBlock; blockNum++) {
      blockNumbers.push(blockNum);
    }

    if (blockNumbers.length === 0) return { count: 0, lowestProcessed: null };

    // Time RPC calls
    const rpcStart = performance.now();

    // Fetch block headers (light, no transactions) and receipts in parallel
    const results = await Promise.allSettled(
      blockNumbers.map(async (blockNum) => {
        const [block, receipts] = await Promise.all([
          rpc.getBlock(blockNum),
          rpc.getBlockReceipts(blockNum),
        ]);
        return { blockNum, block, receipts };
      })
    );

    const rpcTime = performance.now() - rpcStart;

    // Process results
    const updates: Array<{ blockNumber: bigint; totalPriorityFeeGwei: number }> = [];
    let lowestProcessed: bigint | null = null;

    for (const result of results) {
      if (result.status === 'rejected') continue;
      const { blockNum, block, receipts } = result.value;
      if (!block || !receipts) continue;

      const baseFeePerGas = block.baseFeePerGas ?? 0n;
      const totalPriorityFeeGwei = this.calculatePriorityFee(baseFeePerGas, receipts);
      updates.push({ blockNumber: blockNum, totalPriorityFeeGwei });

      if (lowestProcessed === null || blockNum < lowestProcessed) {
        lowestProcessed = blockNum;
      }
    }

    if (updates.length === 0) {
      return { count: 0, lowestProcessed: null };
    }

    // Time DB update
    const dbStart = performance.now();
    const count = await updateBlocksPriorityFeeBatch(updates);
    const dbTime = performance.now() - dbStart;

    console.log(`[PriorityFeeFixer] Timing: RPC=${(rpcTime / 1000).toFixed(1)}s, DB=${(dbTime / 1000).toFixed(1)}s for ${updates.length} blocks`);

    return { count, lowestProcessed };
  }

  /**
   * Calculate total priority fee from receipts.
   * Uses effectiveGasPrice from receipts: priorityFee = (effectiveGasPrice - baseFeePerGas) * gasUsed
   */
  private calculatePriorityFee(baseFeePerGas: bigint, receipts: TransactionReceipt[]): number {
    let totalPriorityFee = 0n;

    for (const receipt of receipts) {
      const effectiveGasPrice = receipt.effectiveGasPrice ?? 0n;
      const priorityFeePerGas = effectiveGasPrice > baseFeePerGas
        ? effectiveGasPrice - baseFeePerGas
        : 0n;
      totalPriorityFee += priorityFeePerGas * receipt.gasUsed;
    }

    return weiToGwei(totalPriorityFee);
  }
}

// Query functions for status API
export async function getPriorityFeeFixStatus(): Promise<{
  fixDeployedAtBlock: bigint | null;
  lastFixedBlock: bigint | null;
  earliestBlock: bigint | null;
  totalToFix: bigint;
  totalFixed: bigint;
  percentComplete: number;
  isComplete: boolean;
} | null> {
  const status = await queryOne<PriorityFeeFixStatus>(
    `SELECT fix_deployed_at_block, last_fixed_block FROM priority_fee_fix_status WHERE id = 1`
  );

  if (!status || status.fix_deployed_at_block === '0') {
    return null;
  }

  const stats = await getTableStats('blocks');
  if (!stats) {
    return null;
  }

  const fixDeployedAtBlock = BigInt(status.fix_deployed_at_block);
  const lastFixedBlock = status.last_fixed_block ? BigInt(status.last_fixed_block) : fixDeployedAtBlock;
  const earliestBlock = stats.minValue;

  const totalToFix = fixDeployedAtBlock - earliestBlock;
  const totalFixed = fixDeployedAtBlock - lastFixedBlock;
  const percentComplete = totalToFix > 0n ? Number((totalFixed * 100n) / totalToFix) : 100;
  const isComplete = lastFixedBlock <= earliestBlock;

  return {
    fixDeployedAtBlock,
    lastFixedBlock,
    earliestBlock,
    totalToFix,
    totalFixed,
    percentComplete,
    isComplete,
  };
}
