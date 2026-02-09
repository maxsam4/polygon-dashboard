import { getRpcClient, TransactionReceipt } from '../rpc';
import { Block } from '../types';
import { calculatePriorityFeeMetrics } from './priorityFeeBackfill';
import { pushBlockUpdates } from '../liveStreamClient';

interface EnrichResult {
  enrichedCount: number;
}

interface EnrichOptions {
  pushToLiveStream?: boolean;
  signal?: AbortSignal;
}

interface ApplyOptions {
  pushToLiveStream?: boolean;
}

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minute fallback for callers without signal

/**
 * Apply pre-fetched receipts to blocks, computing priority fee metrics in-place.
 *
 * No RPC calls — takes a receipts map (from getBlocksReceiptsReliably) and
 * mutates blocks with computed priority fee metrics.
 */
export function applyReceiptsToBlocks(
  blocks: Block[],
  receiptsMap: Map<bigint, TransactionReceipt[]>,
  options: ApplyOptions = {}
): EnrichResult {
  const blocksWithTx = blocks.filter(b => b.txCount > 0);

  if (blocksWithTx.length === 0) {
    return { enrichedCount: 0 };
  }

  let enrichedCount = 0;
  const liveStreamPayloads: Array<{
    blockNumber: number;
    txCount: number;
    minPriorityFeeGwei: number;
    maxPriorityFeeGwei: number;
    avgPriorityFeeGwei: number;
    medianPriorityFeeGwei: number;
    totalPriorityFeeGwei: number;
  }> = [];

  for (const block of blocksWithTx) {
    const receipts = receiptsMap.get(block.blockNumber);

    if (!receipts || receipts.length === 0) continue;

    const metrics = calculatePriorityFeeMetrics(receipts, block.baseFeeGwei);

    if (metrics.avgPriorityFeeGwei !== null && metrics.totalPriorityFeeGwei !== null) {
      block.minPriorityFeeGwei = metrics.minPriorityFeeGwei;
      block.maxPriorityFeeGwei = metrics.maxPriorityFeeGwei;
      block.avgPriorityFeeGwei = metrics.avgPriorityFeeGwei;
      block.medianPriorityFeeGwei = metrics.medianPriorityFeeGwei;
      block.totalPriorityFeeGwei = metrics.totalPriorityFeeGwei;
      enrichedCount++;

      if (options.pushToLiveStream) {
        liveStreamPayloads.push({
          blockNumber: Number(block.blockNumber),
          txCount: block.txCount,
          minPriorityFeeGwei: metrics.minPriorityFeeGwei,
          maxPriorityFeeGwei: metrics.maxPriorityFeeGwei,
          avgPriorityFeeGwei: metrics.avgPriorityFeeGwei,
          medianPriorityFeeGwei: metrics.medianPriorityFeeGwei,
          totalPriorityFeeGwei: metrics.totalPriorityFeeGwei,
        });
      }
    }
  }

  // Push updates to live-stream service (fire-and-forget)
  if (liveStreamPayloads.length > 0) {
    pushBlockUpdates(liveStreamPayloads).catch(() => {});
  }

  return { enrichedCount };
}

/**
 * Enrich blocks with receipt-based priority fee metrics (all-or-nothing).
 *
 * Uses indefinite round-robin RPC retry to guarantee receipts for every block.
 * Only returns on success or abort — never inserts blocks with incomplete data.
 */
export async function enrichBlocksWithReceipts(
  blocks: Block[],
  options: EnrichOptions = {}
): Promise<EnrichResult> {
  const blocksWithTx = blocks.filter(b => b.txCount > 0);

  if (blocksWithTx.length === 0) {
    return { enrichedCount: 0 };
  }

  const signal = options.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);

  const rpc = getRpcClient();
  const blockNumbers = blocksWithTx.map(b => b.blockNumber);
  const receiptsMap = await rpc.getBlocksReceiptsReliably(blockNumbers, signal);

  return applyReceiptsToBlocks(blocks, receiptsMap, { pushToLiveStream: options.pushToLiveStream });
}
