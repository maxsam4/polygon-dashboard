// Transaction test fixtures

import type { TransactionReceipt } from 'viem';

// EIP-1559 transaction (with maxPriorityFeePerGas)
export interface Eip1559Transaction {
  hash: `0x${string}`;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas?: bigint;
  gas: bigint;
  gasUsed?: bigint;
}

// Legacy transaction (with gasPrice)
export interface LegacyTransaction {
  hash: `0x${string}`;
  gasPrice: bigint;
  gas: bigint;
  gasUsed?: bigint;
}

export type TransactionLike = Eip1559Transaction | LegacyTransaction;

export function createEip1559Transaction(
  index: number,
  priorityFeeGwei: number,
  gasUsed?: bigint
): Eip1559Transaction {
  return {
    hash: `0x${index.toString(16).padStart(64, '0')}` as `0x${string}`,
    maxPriorityFeePerGas: BigInt(Math.floor(priorityFeeGwei * 1e9)),
    maxFeePerGas: BigInt(Math.floor((priorityFeeGwei + 100) * 1e9)),
    gas: 21000n,
    gasUsed,
  };
}

export function createLegacyTransaction(
  index: number,
  gasPriceGwei: number,
  gasUsed?: bigint
): LegacyTransaction {
  return {
    hash: `0x${(index + 1000).toString(16).padStart(64, '0')}` as `0x${string}`,
    gasPrice: BigInt(Math.floor(gasPriceGwei * 1e9)),
    gas: 21000n,
    gasUsed,
  };
}

export function createTransactionReceipt(
  txHash: `0x${string}`,
  blockNumber: bigint,
  gasUsed: bigint,
  effectiveGasPrice: bigint
): TransactionReceipt {
  return {
    transactionHash: txHash,
    transactionIndex: 0,
    blockHash: `0x${blockNumber.toString(16).padStart(64, '0')}` as `0x${string}`,
    blockNumber,
    from: '0x1234567890123456789012345678901234567890' as `0x${string}`,
    to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as `0x${string}`,
    cumulativeGasUsed: gasUsed,
    gasUsed,
    effectiveGasPrice,
    contractAddress: null,
    logs: [],
    logsBloom: '0x' + '0'.repeat(512) as `0x${string}`,
    status: 'success',
    type: 'eip1559',
    root: undefined,
    blobGasPrice: undefined,
    blobGasUsed: undefined,
  };
}

// Sample batch of mixed transactions for testing
export function createMixedTransactionBatch(count: number): {
  transactions: TransactionLike[];
  receipts: TransactionReceipt[];
} {
  const transactions: TransactionLike[] = [];
  const receipts: TransactionReceipt[] = [];
  const blockNumber = 50000000n;

  for (let i = 0; i < count; i++) {
    const gasUsed = 21000n + BigInt(i * 1000);
    const priorityFee = 5 + i; // 5-105 gwei range

    if (i % 2 === 0) {
      // EIP-1559 transaction
      const tx = createEip1559Transaction(i, priorityFee, gasUsed);
      transactions.push(tx);
      receipts.push(createTransactionReceipt(
        tx.hash,
        blockNumber,
        gasUsed,
        BigInt(Math.floor((priorityFee + 30) * 1e9)) // effective = priority + base
      ));
    } else {
      // Legacy transaction
      const tx = createLegacyTransaction(i, priorityFee + 30, gasUsed); // gasPrice > baseFee
      transactions.push(tx);
      receipts.push(createTransactionReceipt(
        tx.hash,
        blockNumber,
        gasUsed,
        BigInt(Math.floor((priorityFee + 30) * 1e9))
      ));
    }
  }

  return { transactions, receipts };
}

// Empty block transactions
export const emptyTransactions: TransactionLike[] = [];
export const emptyReceipts: TransactionReceipt[] = [];
