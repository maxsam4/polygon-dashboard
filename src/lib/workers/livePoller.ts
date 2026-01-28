import { getRpcClient, RpcExhaustedError, getBlockSubscriptionManager, WsBlock } from '@/lib/rpc';
import { calculateBlockMetrics } from '@/lib/gas';
import {
  getHighestBlockNumber,
  insertBlock,
  insertBlocksBatch,
  updateBlockPriorityFees
} from '@/lib/queries/blocks';
import { Block } from '@/lib/types';
import { sleep } from '@/lib/utils';
import { insertGap } from '@/lib/queries/gaps';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from './workerStatus';
import { updateTableStats } from '@/lib/queries/stats';
import { blockChannel } from '@/lib/blockChannel';

const WORKER_NAME = 'LivePoller';

const POLL_INTERVAL_MS = 2000; // Fallback polling interval when no WebSocket
const EXHAUSTED_RETRY_MS = 5000; // 5 seconds - keep trying, don't wait long
const MAX_GAP = 30; // If gap > 30 blocks, skip to latest and let backfiller handle
const BATCH_SIZE = 10; // Process up to 10 blocks at a time when slightly behind

interface PriorityFeeTask {
  blockNumber: bigint;
  wsBlock: WsBlock;
  blockTimestamp: Date;
}

export class LivePoller {
  private running = false;
  private lastProcessedBlock: bigint | null = null;
  private lastBlockTimestamp: bigint | null = null; // Cache for previous block timestamp
  private processing = false; // Mutex to prevent concurrent processing
  private pendingBlockNumber: bigint | null = null; // Track latest notification during processing
  private useSubscriptions = false;

  // Queue for serializing async priority fee updates (prevents DB overload)
  private priorityFeeQueue: PriorityFeeTask[] = [];
  private priorityFeeProcessing = false;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    initWorkerStatus(WORKER_NAME);
    updateWorkerState(WORKER_NAME, 'running');

    // Initialize from database
    this.lastProcessedBlock = await getHighestBlockNumber();
    console.log(`[LivePoller] Starting from block ${this.lastProcessedBlock?.toString() ?? 'none'}`);

    // Try to use WebSocket subscriptions if available
    const subscriptionManager = getBlockSubscriptionManager();
    if (subscriptionManager) {
      this.useSubscriptions = true;
      console.log('[LivePoller] Using WebSocket subscriptions for new blocks');
      subscriptionManager.start((blockNumber) => this.onNewBlock(blockNumber));
      // Also start polling as backup (with longer interval)
      this.pollBackup();
    } else {
      console.log('[LivePoller] No WebSocket URLs configured, using polling');
      this.poll();
    }
  }

  stop(): void {
    this.running = false;
    updateWorkerState(WORKER_NAME, 'stopped');

    // Stop subscriptions if using them
    const subscriptionManager = getBlockSubscriptionManager();
    if (subscriptionManager) {
      subscriptionManager.stop();
    }
  }

  /**
   * Called when WebSocket receives a new block with full data.
   * Processes immediately without any RPC calls for instant frontend updates.
   */
  private async onNewBlock(wsBlock: WsBlock): Promise<void> {
    if (!this.running) return;

    const blockNumber = wsBlock.number;

    // Skip if we've already processed this block
    if (this.lastProcessedBlock !== null && blockNumber <= this.lastProcessedBlock) {
      return;
    }

    // Check for gaps - if we missed blocks, record them for gapfiller
    if (this.lastProcessedBlock !== null) {
      const gap = blockNumber - this.lastProcessedBlock - 1n;
      if (gap > 0n) {
        const skippedFrom = this.lastProcessedBlock + 1n;
        const skippedTo = blockNumber - 1n;
        // Record gap async (don't block)
        insertGap('block', skippedFrom, skippedTo, 'live_poller').catch(err =>
          console.warn('[LivePoller] Failed to record gap:', err)
        );
        console.log(`[LivePoller] Gap detected: ${skippedFrom}-${skippedTo}, recorded for gapfiller`);
      }
    }

    try {
      updateWorkerState(WORKER_NAME, 'running');

      // Calculate metrics using cached previous timestamp (no RPC call needed!)
      const previousTimestamp = this.lastBlockTimestamp ?? undefined;
      const metrics = calculateBlockMetrics({
        baseFeePerGas: wsBlock.baseFeePerGas,
        gasUsed: wsBlock.gasUsed,
        timestamp: wsBlock.timestamp,
        transactions: wsBlock.transactions,
      }, previousTimestamp);

      const blockTimestamp = new Date(Number(wsBlock.timestamp) * 1000);

      const blockData: Omit<Block, 'createdAt' | 'updatedAt'> = {
        blockNumber,
        timestamp: blockTimestamp,
        blockHash: wsBlock.hash,
        parentHash: wsBlock.parentHash,
        gasUsed: wsBlock.gasUsed,
        gasLimit: wsBlock.gasLimit,
        baseFeeGwei: metrics.baseFeeGwei,
        minPriorityFeeGwei: metrics.minPriorityFeeGwei,
        maxPriorityFeeGwei: metrics.maxPriorityFeeGwei,
        avgPriorityFeeGwei: metrics.avgPriorityFeeGwei,
        medianPriorityFeeGwei: metrics.medianPriorityFeeGwei,
        totalBaseFeeGwei: metrics.totalBaseFeeGwei,
        totalPriorityFeeGwei: metrics.totalPriorityFeeGwei,
        txCount: wsBlock.transactions.length,
        blockTimeSec: metrics.blockTimeSec,
        mgasPerSec: metrics.mgasPerSec,
        tps: metrics.tps,
        finalized: false,
        finalizedAt: null,
        milestoneId: null,
        timeToFinalitySec: null,
      };

      // IMMEDIATELY publish to SSE for instant frontend update (before DB insert)
      blockChannel.publish(blockData as Block);

      // Update state
      this.lastProcessedBlock = blockNumber;
      this.lastBlockTimestamp = wsBlock.timestamp;

      // Insert to DB async (fire-and-forget) - don't block the notification handler
      insertBlock(blockData).catch(err =>
        console.error('[LivePoller] DB insert failed:', err)
      );

      // Update stats cache async (fire-and-forget)
      updateTableStats('blocks', blockNumber, blockNumber, 1).catch(err =>
        console.warn('[LivePoller] Stats update failed:', err)
      );

      updateWorkerRun(WORKER_NAME, 1);
      console.log(`[LivePoller] Block ${blockNumber} published instantly`);

      // Queue async priority fee filling (serialized to prevent DB overload)
      this.enqueuePriorityFeeUpdate(blockNumber, wsBlock, blockTimestamp);
    } catch (error) {
      console.error('[LivePoller] Error processing WebSocket block:', error);
      updateWorkerError(WORKER_NAME, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Fetch receipts and fill in priority fee metrics asynchronously.
   * Called after instant publish to update the block with accurate gasUsed-based metrics.
   */
  private async fillPriorityFeesAsync(
    blockNumber: bigint,
    wsBlock: WsBlock,
    blockTimestamp: Date
  ): Promise<void> {
    const rpc = getRpcClient();

    // Fetch receipts for this block
    const receipts = await rpc.getBlockReceipts(blockNumber);
    if (!receipts || receipts.length === 0) {
      // No receipts (empty block or RPC issue), nothing to update
      return;
    }

    // Build transaction map with gasUsed from receipts
    const receiptMap = new Map(receipts.map(r => [r.transactionHash, r]));
    const transactionsWithGasUsed = wsBlock.transactions.map(tx => {
      const receipt = receiptMap.get(tx.hash);
      return {
        ...tx,
        gasUsed: receipt?.gasUsed,
      };
    });

    // Recalculate metrics with actual gasUsed
    const metrics = calculateBlockMetrics({
      baseFeePerGas: wsBlock.baseFeePerGas,
      gasUsed: wsBlock.gasUsed,
      timestamp: wsBlock.timestamp,
      transactions: transactionsWithGasUsed,
    });

    // Skip if we still don't have all gasUsed values (shouldn't happen but be safe)
    if (metrics.avgPriorityFeeGwei === null || metrics.totalPriorityFeeGwei === null) {
      return;
    }

    // Update DB with correct priority fee values
    // Pass timestamp for efficient TimescaleDB chunk pruning
    await updateBlockPriorityFees(
      blockNumber,
      blockTimestamp,
      metrics.avgPriorityFeeGwei,
      metrics.totalPriorityFeeGwei
    );

    // Publish update to SSE so frontend gets the corrected values
    const updatedBlock = {
      blockNumber,
      timestamp: blockTimestamp,
      blockHash: wsBlock.hash,
      parentHash: wsBlock.parentHash,
      gasUsed: wsBlock.gasUsed,
      gasLimit: wsBlock.gasLimit,
      baseFeeGwei: metrics.baseFeeGwei,
      minPriorityFeeGwei: metrics.minPriorityFeeGwei,
      maxPriorityFeeGwei: metrics.maxPriorityFeeGwei,
      avgPriorityFeeGwei: metrics.avgPriorityFeeGwei,
      medianPriorityFeeGwei: metrics.medianPriorityFeeGwei,
      totalBaseFeeGwei: metrics.totalBaseFeeGwei,
      totalPriorityFeeGwei: metrics.totalPriorityFeeGwei,
      txCount: wsBlock.transactions.length,
      blockTimeSec: metrics.blockTimeSec,
      mgasPerSec: metrics.mgasPerSec,
      tps: metrics.tps,
      finalized: false,
      finalizedAt: null,
      milestoneId: null,
      timeToFinalitySec: null,
    };

    blockChannel.publish(updatedBlock as Block);
    console.log(`[LivePoller] Block ${blockNumber} priority fees filled`);
  }

  /**
   * Enqueue a priority fee update task. Tasks are processed serially to avoid DB overload.
   */
  private enqueuePriorityFeeUpdate(blockNumber: bigint, wsBlock: WsBlock, blockTimestamp: Date): void {
    this.priorityFeeQueue.push({ blockNumber, wsBlock, blockTimestamp });
    // Start processing if not already running
    if (!this.priorityFeeProcessing) {
      this.processPriorityFeeQueue();
    }
  }

  /**
   * Process the priority fee queue one task at a time.
   */
  private async processPriorityFeeQueue(): Promise<void> {
    if (this.priorityFeeProcessing) return;
    this.priorityFeeProcessing = true;

    while (this.priorityFeeQueue.length > 0) {
      const task = this.priorityFeeQueue.shift();
      if (!task) break;

      try {
        await this.fillPriorityFeesAsync(task.blockNumber, task.wsBlock, task.blockTimestamp);
      } catch (err) {
        console.warn(`[LivePoller] Failed to fill priority fees for block ${task.blockNumber}:`, err);
      }
    }

    this.priorityFeeProcessing = false;
  }

  /**
   * Backup polling when using subscriptions - runs less frequently to catch any missed blocks.
   */
  private async pollBackup(): Promise<void> {
    const BACKUP_POLL_INTERVAL = 10000; // 10 seconds backup check
    while (this.running) {
      await sleep(BACKUP_POLL_INTERVAL);
      if (!this.running) break;

      // Only poll if not currently processing
      if (!this.processing) {
        try {
          const processed = await this.processNewBlocks();
          if (processed > 0) {
            console.log(`[LivePoller] Backup poll caught ${processed} missed blocks`);
            updateWorkerRun(WORKER_NAME, processed);
          }
        } catch (error) {
          // Errors in backup poll are not critical
          console.warn('[LivePoller] Backup poll error:', error);
        }
      }
    }
  }

  /**
   * Main polling loop (used when WebSocket not available).
   */
  private async poll(): Promise<void> {
    while (this.running) {
      try {
        updateWorkerState(WORKER_NAME, 'running');
        const processed = await this.processNewBlocks();
        if (processed > 0) {
          updateWorkerRun(WORKER_NAME, processed);
        } else {
          updateWorkerState(WORKER_NAME, 'idle');
        }
        await sleep(POLL_INTERVAL_MS);
      } catch (error) {
        if (error instanceof RpcExhaustedError) {
          console.error('[LivePoller] RPC exhausted, waiting 5 seconds...');
          updateWorkerError(WORKER_NAME, 'RPC exhausted');
          await sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[LivePoller] Error:', error);
          updateWorkerError(WORKER_NAME, error instanceof Error ? error.message : 'Unknown error');
          await sleep(POLL_INTERVAL_MS);
        }
      }
    }
  }

  private async processNewBlocks(): Promise<number> {
    const rpc = getRpcClient();
    const latestBlockNumber = await rpc.getLatestBlockNumber();

    if (this.lastProcessedBlock === null) {
      this.lastProcessedBlock = latestBlockNumber - 1n;
    }

    const gap = latestBlockNumber - this.lastProcessedBlock;

    if (gap <= 0n) {
      return 0;
    }

    // If gap is too large, skip to near the tip and let gapfiller handle the gap
    if (gap > BigInt(MAX_GAP)) {
      const skippedFrom = this.lastProcessedBlock + 1n;
      const skippedTo = latestBlockNumber - BigInt(MAX_GAP) - 1n;
      this.lastProcessedBlock = latestBlockNumber - BigInt(MAX_GAP);

      // Record gap for gapfiller
      if (skippedTo >= skippedFrom) {
        await insertGap('block', skippedFrom, skippedTo, 'live_poller');
      }
      console.log(`[LivePoller] Gap too large (${gap} blocks), recorded gap ${skippedFrom}-${skippedTo} for gapfiller`);
    }

    // Process blocks in batches
    const blocksToProcess = Number(latestBlockNumber - this.lastProcessedBlock);
    const batchSize = Math.min(blocksToProcess, BATCH_SIZE);

    if (batchSize > 1) {
      return await this.processBatch(this.lastProcessedBlock + 1n, this.lastProcessedBlock + BigInt(batchSize));
    } else {
      // Process single block
      await this.processBlock(this.lastProcessedBlock + 1n);
      this.lastProcessedBlock = this.lastProcessedBlock + 1n;
      return 1;
    }
  }

  private async processBatch(startBlock: bigint, endBlock: bigint): Promise<number> {
    const blocksToFetch = Number(endBlock - startBlock) + 1;
    const rpc = getRpcClient();
    const blocks: Omit<Block, 'createdAt' | 'updatedAt'>[] = [];

    const blockNumbers = Array.from(
      { length: blocksToFetch },
      (_, i) => startBlock + BigInt(i)
    );

    // Fetch all blocks and receipts in parallel
    const [blockResults, receiptResults] = await Promise.all([
      rpc.getBlocksWithTransactions(blockNumbers),
      rpc.getBlocksReceipts(blockNumbers),
    ]);

    // Get first block's previous timestamp (use cache or fetch)
    let prevTimestamp = this.lastBlockTimestamp;
    if (prevTimestamp === null && startBlock > 0n) {
      try {
        const prevBlock = await rpc.getBlock(startBlock - 1n);
        prevTimestamp = prevBlock.timestamp;
      } catch {
        // If we can't get previous timestamp, block time will be null
      }
    }

    // Process blocks in order
    for (const blockNumber of blockNumbers) {
      const block = blockResults.get(blockNumber);
      if (!block) continue;

      const receipts = receiptResults.get(blockNumber) ?? [];

      // Merge gasUsed from receipts into transactions
      const receiptMap = new Map(receipts.map(r => [r.transactionHash, r]));
      const transactionsWithGasUsed = block.transactions.map(tx => {
        if (typeof tx === 'string') return tx;
        const receipt = receiptMap.get(tx.hash);
        return { ...tx, gasUsed: receipt?.gasUsed };
      });
      const blockWithReceipts = { ...block, transactions: transactionsWithGasUsed };

      const metrics = calculateBlockMetrics(blockWithReceipts, prevTimestamp ?? undefined);
      const blockTimestamp = new Date(Number(block.timestamp) * 1000);

      blocks.push({
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
      });

      // Update prevTimestamp for next block in batch
      prevTimestamp = block.timestamp;
    }

    if (blocks.length > 0) {
      blocks.sort((a, b) => Number(a.blockNumber - b.blockNumber));
      await insertBlocksBatch(blocks);
      this.lastProcessedBlock = blocks[blocks.length - 1].blockNumber;
      // Cache the last block's timestamp for next iteration
      this.lastBlockTimestamp = prevTimestamp;

      // Update stats cache async (fire-and-forget)
      const minBlock = blocks[0].blockNumber;
      const maxBlock = blocks[blocks.length - 1].blockNumber;
      updateTableStats('blocks', minBlock, maxBlock, blocks.length).catch(err =>
        console.warn('[LivePoller] Stats update failed:', err)
      );

      // Publish to channel for real-time SSE updates
      blockChannel.publishBatch(blocks as Block[]);

      console.log(`[LivePoller] Inserted ${blocks.length} blocks (${startBlock}-${this.lastProcessedBlock})`);
      return blocks.length;
    }
    return 0;
  }

  private async processBlock(blockNumber: bigint): Promise<void> {
    const rpc = getRpcClient();

    // Get block with transactions and receipts in parallel
    const [block, receipts] = await Promise.all([
      rpc.getBlockWithTransactions(blockNumber),
      rpc.getBlockReceipts(blockNumber),
    ]);

    // Merge gasUsed from receipts into transactions
    const receiptMap = new Map(
      (receipts ?? []).map(r => [r.transactionHash, r])
    );
    const transactionsWithGasUsed = block.transactions.map(tx => {
      if (typeof tx === 'string') return tx;
      const receipt = receiptMap.get(tx.hash);
      return { ...tx, gasUsed: receipt?.gasUsed };
    });
    const blockWithReceipts = { ...block, transactions: transactionsWithGasUsed };

    // Use cached timestamp if available, otherwise fetch from RPC (not DB)
    let previousTimestamp: bigint | undefined = this.lastBlockTimestamp ?? undefined;
    if (previousTimestamp === undefined && blockNumber > 0n) {
      try {
        const prevBlockRpc = await rpc.getBlock(blockNumber - 1n);
        previousTimestamp = prevBlockRpc.timestamp;
      } catch {
        // If we can't get previous timestamp, block time will be null
      }
    }

    // Calculate metrics
    const metrics = calculateBlockMetrics(blockWithReceipts, previousTimestamp);
    const blockTimestamp = new Date(Number(block.timestamp) * 1000);

    // Insert/update block - finality is set by the reconciler, not here
    // INSERT ON CONFLICT handles reorgs automatically (updates if hash differs and not finalized)
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

    // Cache this block's timestamp for next iteration
    this.lastBlockTimestamp = block.timestamp;

    // Update stats cache async (fire-and-forget)
    updateTableStats('blocks', blockNumber, blockNumber, 1).catch(err =>
      console.warn('[LivePoller] Stats update failed:', err)
    );

    // Publish to channel for real-time SSE updates
    blockChannel.publish(blockData as Block);

    console.log(`[LivePoller] Processed block ${blockNumber}`);
  }
}
