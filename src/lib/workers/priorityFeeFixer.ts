import { getRpcClient, RpcExhaustedError } from '@/lib/rpc';
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

        const processed = await this.processBatch(effectiveStart, batchEnd);

        if (processed > 0) {
          // Update last_fixed_block to the lowest block we fixed
          await query(
            `UPDATE priority_fee_fix_status SET last_fixed_block = $1, updated_at = NOW() WHERE id = 1`,
            [effectiveStart.toString()]
          );
          updateWorkerRun(WORKER_NAME, processed);
          console.log(`[PriorityFeeFixer] Fixed ${processed} blocks (${effectiveStart}-${batchEnd}), progress: ${effectiveStart} -> ${earliestBlock}`);
        }

        await sleep(BATCH_DELAY_MS);
      } catch (error) {
        if (error instanceof RpcExhaustedError) {
          console.error('[PriorityFeeFixer] RPC exhausted, waiting...');
          updateWorkerError(WORKER_NAME, 'RPC exhausted');
          await sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[PriorityFeeFixer] Error:', error);
          updateWorkerError(WORKER_NAME, error instanceof Error ? error.message : 'Unknown error');
          await sleep(10000);
        }
      }
    }
  }

  private async processBatch(startBlock: bigint, endBlock: bigint): Promise<number> {
    const rpc = getRpcClient();
    const blockNumbers: bigint[] = [];

    for (let blockNum = startBlock; blockNum <= endBlock; blockNum++) {
      blockNumbers.push(blockNum);
    }

    if (blockNumbers.length === 0) return 0;

    // Fetch blocks and receipts
    const [blocksMap, receiptsMap] = await Promise.all([
      rpc.getBlocksWithTransactions(blockNumbers),
      rpc.getBlocksReceipts(blockNumbers),
    ]);

    let updatedCount = 0;

    for (const blockNum of blockNumbers) {
      const block = blocksMap.get(blockNum);
      const receipts = receiptsMap.get(blockNum);

      if (!block || !receipts) continue;

      // Build receipt map
      const receiptMap = new Map(
        receipts.map(r => [r.transactionHash, r])
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

      updatedCount++;
    }

    return updatedCount;
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
