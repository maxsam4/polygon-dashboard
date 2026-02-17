import { getRpcClient, TransactionReceipt } from '../rpc';
import { Block } from '../types';
import { pushBlockUpdates } from '../liveStreamClient';
import { GWEI } from '../constants';

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
