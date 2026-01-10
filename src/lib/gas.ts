const GWEI = 1_000_000_000n;

export function weiToGwei(wei: bigint): number {
  return Number(wei) / Number(GWEI);
}

interface TransactionLike {
  maxPriorityFeePerGas?: bigint | null;
  gasPrice?: bigint | null;
  gas?: bigint;
}

interface BlockLike {
  baseFeePerGas?: bigint | null;
  gasUsed: bigint;
  timestamp: bigint;
  transactions: TransactionLike[] | string[];
}

export function calculateBlockMetrics(
  block: BlockLike,
  previousBlockTimestamp?: bigint
): {
  baseFeeGwei: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  avgPriorityFeeGwei: number;
  medianPriorityFeeGwei: number;
  totalBaseFeeGwei: number;
  totalPriorityFeeGwei: number;
  blockTimeSec: number | null;
  mgasPerSec: number | null;
  tps: number | null;
} {
  const baseFeePerGas = block.baseFeePerGas ?? 0n;
  const baseFeeGwei = weiToGwei(baseFeePerGas);
  const gasUsed = block.gasUsed;

  // Handle both transaction objects and transaction hashes
  const transactions = block.transactions;
  const hasFullTransactions = transactions.length > 0 && typeof transactions[0] !== 'string';
  const txCount = transactions.length;

  // Calculate priority fees from transactions
  let minPriorityFee = BigInt(Number.MAX_SAFE_INTEGER);
  let maxPriorityFee = 0n;
  let totalPriorityFee = 0n;
  const priorityFees: bigint[] = [];

  if (txCount === 0) {
    minPriorityFee = 0n;
  } else if (hasFullTransactions) {
    for (const tx of transactions as TransactionLike[]) {
      let priorityFee: bigint;

      if (tx.maxPriorityFeePerGas !== undefined && tx.maxPriorityFeePerGas !== null) {
        // EIP-1559 transaction
        priorityFee = tx.maxPriorityFeePerGas;
      } else if (tx.gasPrice !== undefined && tx.gasPrice !== null) {
        // Legacy transaction - priority fee is gasPrice - baseFee
        priorityFee = baseFeePerGas > 0n
          ? (tx.gasPrice > baseFeePerGas ? tx.gasPrice - baseFeePerGas : 0n)
          : tx.gasPrice; // Pre-EIP-1559: all is priority fee
      } else {
        priorityFee = 0n;
      }

      priorityFees.push(priorityFee);
      if (priorityFee < minPriorityFee) minPriorityFee = priorityFee;
      if (priorityFee > maxPriorityFee) maxPriorityFee = priorityFee;
      totalPriorityFee += priorityFee * (tx.gas ?? 0n);
    }
  } else {
    // Only have transaction hashes, not full transactions
    minPriorityFee = 0n;
  }

  const avgPriorityFee = txCount > 0
    ? totalPriorityFee / BigInt(txCount) / (gasUsed > 0n ? gasUsed / BigInt(txCount) : 1n)
    : 0n;

  // Calculate median priority fee
  let medianPriorityFee = 0n;
  if (priorityFees.length > 0) {
    priorityFees.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const mid = Math.floor(priorityFees.length / 2);
    medianPriorityFee = priorityFees.length % 2 === 0
      ? (priorityFees[mid - 1] + priorityFees[mid]) / 2n
      : priorityFees[mid];
  }

  // Calculate totals
  const totalBaseFeeGwei = weiToGwei(baseFeePerGas * gasUsed);
  const totalPriorityFeeGwei = weiToGwei(totalPriorityFee);

  // Calculate throughput metrics
  let blockTimeSec: number | null = null;
  let mgasPerSec: number | null = null;
  let tps: number | null = null;

  if (previousBlockTimestamp !== undefined) {
    blockTimeSec = Number(block.timestamp - previousBlockTimestamp);
    if (blockTimeSec > 0) {
      mgasPerSec = Number(gasUsed) / blockTimeSec / 1_000_000;
      tps = txCount / blockTimeSec;
    }
  }

  return {
    baseFeeGwei,
    minPriorityFeeGwei: weiToGwei(minPriorityFee),
    maxPriorityFeeGwei: weiToGwei(maxPriorityFee),
    avgPriorityFeeGwei: weiToGwei(avgPriorityFee),
    medianPriorityFeeGwei: weiToGwei(medianPriorityFee),
    totalBaseFeeGwei,
    totalPriorityFeeGwei,
    blockTimeSec,
    mgasPerSec,
    tps,
  };
}

export function formatGwei(gwei: number): string {
  if (gwei < 0.01) return gwei.toFixed(4);
  if (gwei < 1) return gwei.toFixed(3);
  if (gwei < 100) return gwei.toFixed(2);
  return gwei.toFixed(1);
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}
