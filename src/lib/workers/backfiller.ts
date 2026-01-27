import { getRpcClient, RpcExhaustedError } from '@/lib/rpc';
import { calculateBlockMetrics } from '@/lib/gas';
import {
  getLowestBlockNumber,
  insertBlocksBatch
} from '@/lib/queries/blocks';
import { Block } from '@/lib/types';
import { sleep } from '@/lib/utils';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from './workerStatus';
import { updateTableStats } from '@/lib/queries/stats';

const WORKER_NAME = 'Backfiller';
const EXHAUSTED_RETRY_MS = 5000; // 5 seconds - keep trying, don't wait long
const BASE_BATCH_SIZE = 50; // Base batch size, multiplied by endpoint count

export class Backfiller {
  private running = false;
  private targetBlock: bigint;
  private delayMs: number;

  constructor(targetBlock: bigint, delayMs = 100) {
    this.targetBlock = targetBlock;
    this.delayMs = delayMs;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    initWorkerStatus(WORKER_NAME);
    updateWorkerState(WORKER_NAME, 'running');

    console.log(`[Backfiller] Starting backfill to block ${this.targetBlock}`);
    this.backfill();
  }

  stop(): void {
    this.running = false;
    updateWorkerState(WORKER_NAME, 'stopped');
  }

  private async backfill(): Promise<void> {
    const rpc = getRpcClient();
    console.log(`[Backfiller] Using ${rpc.endpointCount} RPC endpoints`);

    while (this.running) {
      try {
        updateWorkerState(WORKER_NAME, 'running');
        const lowestBlock = await getLowestBlockNumber();

        if (lowestBlock === null) {
          // No blocks yet, wait for live poller to add some
          console.log('[Backfiller] No blocks in DB yet, waiting...');
          updateWorkerState(WORKER_NAME, 'idle');
          await sleep(5000);
          continue;
        }

        if (lowestBlock <= this.targetBlock) {
          console.log('[Backfiller] Backfill complete!');
          updateWorkerState(WORKER_NAME, 'idle');
          this.running = false;
          return;
        }

        const processed = await this.processBatch(rpc, lowestBlock);
        if (processed > 0) {
          updateWorkerRun(WORKER_NAME, processed);
        }
        await sleep(this.delayMs);
      } catch (error) {
        if (error instanceof RpcExhaustedError) {
          console.error('[Backfiller] RPC exhausted, waiting...');
          updateWorkerError(WORKER_NAME, 'RPC exhausted');
          await sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[Backfiller] Error:', error);
          updateWorkerError(WORKER_NAME, error instanceof Error ? error.message : 'Unknown error');
          await sleep(5000);
        }
      }
    }
  }

  private async processBatch(rpc: ReturnType<typeof getRpcClient>, currentLowest: bigint): Promise<number> {
    // Scale batch size by endpoint count for better parallelism
    const batchSize = BASE_BATCH_SIZE * rpc.endpointCount;
    const startBlock = currentLowest - BigInt(batchSize);
    const endBlock = currentLowest - 1n;
    const targetStart = startBlock < this.targetBlock ? this.targetBlock : startBlock;

    const blockCount = Number(endBlock - targetStart) + 1;
    console.log(`[Backfiller] Fetching blocks ${targetStart} to ${endBlock} (batch of ${blockCount})`);

    // Build list of block numbers to fetch
    const blockNumbers: bigint[] = [];
    for (let blockNum = targetStart; blockNum <= endBlock; blockNum++) {
      blockNumbers.push(blockNum);
    }

    // Also need previous blocks for block time calculation
    const prevBlockNumbers = blockNumbers.map(n => n - 1n).filter(n => n >= 0n);

    // Fetch all blocks, receipts, and previous blocks in parallel across all endpoints
    const [blocksMap, receiptsMap, prevBlocksMap] = await Promise.all([
      rpc.getBlocksWithTransactions(blockNumbers),
      rpc.getBlocksReceipts(blockNumbers),
      rpc.getBlocks(prevBlockNumbers),
    ]);

    const blocks: Omit<Block, 'createdAt' | 'updatedAt'>[] = [];

    for (const blockNum of blockNumbers) {
      const block = blocksMap.get(blockNum);
      if (!block) continue;

      // Merge gasUsed from receipts into transactions
      const receipts = receiptsMap.get(blockNum);
      const receiptMap = new Map(
        (receipts ?? []).map(r => [r.transactionHash, r])
      );
      const transactionsWithGasUsed = block.transactions.map(tx => {
        if (typeof tx === 'string') return tx;
        const receipt = receiptMap.get(tx.hash);
        return { ...tx, gasUsed: receipt?.gasUsed };
      });
      const blockWithReceipts = { ...block, transactions: transactionsWithGasUsed };

      // Get previous block timestamp for block time calculation
      let previousTimestamp: bigint | undefined;
      if (blockNum > 0n) {
        const prevBlock = prevBlocksMap.get(blockNum - 1n);
        if (prevBlock) {
          previousTimestamp = prevBlock.timestamp;
        }
      }

      const metrics = calculateBlockMetrics(blockWithReceipts, previousTimestamp);

      blocks.push({
        blockNumber: blockNum,
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

    if (blocks.length > 0) {
      await insertBlocksBatch(blocks);

      // Update stats cache with batch min/max (backfiller fills backwards, so targetStart is min)
      const minBlock = targetStart;
      const maxBlock = endBlock;
      await updateTableStats('blocks', minBlock, maxBlock, blocks.length);

      console.log(`[Backfiller] Inserted ${blocks.length} blocks (lowest: ${targetStart})`);
      return blocks.length;
    }
    return 0;
  }
}
