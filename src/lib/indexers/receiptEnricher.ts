import { getRpcClient } from '../rpc';
import { Block } from '../types';
import { calculatePriorityFeeMetrics } from './priorityFeeBackfill';
import { pushBlockUpdates } from '../liveStreamClient';

interface EnrichResult {
  enrichedCount: number;
  failedBlockNumbers: bigint[];
}

interface EnrichOptions {
  pushToLiveStream?: boolean;
}

/**
 * Enrich blocks with receipt-based priority fee metrics.
 *
 * Fetches receipts for blocks with transactions, calculates accurate priority fees
 * from effectiveGasPrice, and overwrites the tx-level estimates in-place.
 * Blocks where receipts fail keep their tx-level estimates (avg/total stay NULL).
 */
export async function enrichBlocksWithReceipts(
  blocks: Block[],
  options: EnrichOptions = {}
): Promise<EnrichResult> {
  const blocksWithTx = blocks.filter(b => b.txCount > 0);

  if (blocksWithTx.length === 0) {
    return { enrichedCount: 0, failedBlockNumbers: [] };
  }

  const rpc = getRpcClient();
  const blockNumbers = blocksWithTx.map(b => b.blockNumber);
  const receiptsMap = await rpc.getBlocksReceipts(blockNumbers);

  let enrichedCount = 0;
  const failedBlockNumbers: bigint[] = [];
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

    if (!receipts || receipts.length === 0) {
      failedBlockNumbers.push(block.blockNumber);
      continue;
    }

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

  return { enrichedCount, failedBlockNumbers };
}
