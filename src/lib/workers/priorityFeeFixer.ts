import { getRpcClient, RpcExhaustedError, RpcClient, TransactionReceipt } from '@/lib/rpc';
import { weiToGwei } from '@/lib/gas';
import { query, queryOne } from '@/lib/db';
import { sleep } from '@/lib/utils';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from './workerStatus';
import { getTableStats } from '@/lib/queries/stats';

const WORKER_NAME = 'PriorityFeeFixer';

const BATCH_SIZE = 10; // Number of blocks to process per batch
const BATCH_DELAY_MS = 100; // Delay between batches to not overload RPC
const EXHAUSTED_RETRY_MS = 1000; // Wait 1 second if RPC exhausted

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
          // All blocks in batch failed - apply a small delay before retrying
          console.warn(`[PriorityFeeFixer] Batch ${effectiveStart}-${batchEnd} had no successful updates, retrying...`);
          await sleep(EXHAUSTED_RETRY_MS);
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
   * Process a batch of blocks with per-block error isolation.
   * Each block is processed independently so one failing endpoint doesn't block others.
   * Returns the count of successfully processed blocks and the lowest block number that was processed.
   */
  private async processBatch(startBlock: bigint, endBlock: bigint): Promise<{ count: number; lowestProcessed: bigint | null }> {
    const rpc = getRpcClient();
    const blockNumbers: bigint[] = [];

    for (let blockNum = startBlock; blockNum <= endBlock; blockNum++) {
      blockNumbers.push(blockNum);
    }

    if (blockNumbers.length === 0) return { count: 0, lowestProcessed: null };

    // Process blocks in parallel with individual error handling
    const results = await Promise.allSettled(
      blockNumbers.map(async (blockNum) => {
        try {
          return await this.processBlock(rpc, blockNum);
        } catch (error) {
          // Log but don't throw - block will be retried later
          if (error instanceof RpcExhaustedError) {
            // Don't log every exhausted error to avoid spam
          } else {
            console.warn(`[PriorityFeeFixer] Block ${blockNum} failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          throw error;
        }
      })
    );

    // Count successes and track which blocks were processed
    let successCount = 0;
    let lowestProcessed: bigint | null = null;
    let highestProcessed: bigint | null = null;

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        const blockNum = blockNumbers[i];
        successCount++;
        if (lowestProcessed === null || blockNum < lowestProcessed) {
          lowestProcessed = blockNum;
        }
        if (highestProcessed === null || blockNum > highestProcessed) {
          highestProcessed = blockNum;
        }
      }
    }

    return { count: successCount, lowestProcessed };
  }

  /**
   * Process a single block - fetch data and update priority fee.
   * Throws on failure so caller can handle.
   */
  private async processBlock(rpc: RpcClient, blockNum: bigint): Promise<void> {
    // Fetch block and receipts in parallel
    const [block, receipts] = await Promise.all([
      rpc.getBlockWithTransactions(blockNum),
      rpc.getBlockReceipts(blockNum),
    ]);

    if (!block || !receipts) {
      throw new Error(`Missing data for block ${blockNum}`);
    }

    // Build receipt map
    const receiptMap = new Map<`0x${string}`, TransactionReceipt>(
      receipts.map((r): [`0x${string}`, TransactionReceipt] => [r.transactionHash, r])
    );

    // Calculate correct total priority fee
    const baseFeePerGas = block.baseFeePerGas ?? 0n;
    let totalPriorityFee = 0n;

    for (const tx of block.transactions) {
      if (typeof tx === 'string') continue;

      let priorityFee: bigint;
      if (tx.maxPriorityFeePerGas !== undefined && tx.maxPriorityFeePerGas !== null) {
        priorityFee = tx.maxPriorityFeePerGas;
      } else if (tx.gasPrice !== undefined && tx.gasPrice !== null) {
        priorityFee = baseFeePerGas > 0n
          ? (tx.gasPrice > baseFeePerGas ? tx.gasPrice - baseFeePerGas : 0n)
          : tx.gasPrice;
      } else {
        priorityFee = 0n;
      }

      // Get gasUsed from receipt
      const receipt = receiptMap.get(tx.hash);
      const gasUsed = receipt?.gasUsed ?? tx.gas ?? 0n;

      totalPriorityFee += priorityFee * gasUsed;
    }

    const totalPriorityFeeGwei = weiToGwei(totalPriorityFee);

    // Update the block's total_priority_fee_gwei
    await query(
      `UPDATE blocks SET total_priority_fee_gwei = $1, updated_at = NOW() WHERE block_number = $2`,
      [totalPriorityFeeGwei, blockNum.toString()]
    );
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
