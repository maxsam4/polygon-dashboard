// Block test fixtures

import type { Block, BlockRow } from '@/lib/types';

export const SAMPLE_BLOCK_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`;
export const SAMPLE_PARENT_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as `0x${string}`;

export const sampleBlock: Block = {
  blockNumber: 50000000n,
  timestamp: new Date('2024-01-15T12:00:00Z'),
  blockHash: SAMPLE_BLOCK_HASH,
  parentHash: SAMPLE_PARENT_HASH,
  gasUsed: 15000000n,
  gasLimit: 30000000n,
  baseFeeGwei: 30,
  minPriorityFeeGwei: 1,
  maxPriorityFeeGwei: 100,
  avgPriorityFeeGwei: 25,
  medianPriorityFeeGwei: 20,
  totalBaseFeeGwei: 450000000,
  totalPriorityFeeGwei: 375000000,
  txCount: 150,
  blockTimeSec: 2,
  mgasPerSec: 7.5,
  tps: 75,
  finalized: false,
  finalizedAt: null,
  milestoneId: null,
  timeToFinalitySec: null,
};

export const sampleBlockRow: BlockRow = {
  block_number: '50000000',
  timestamp: new Date('2024-01-15T12:00:00Z'),
  block_hash: SAMPLE_BLOCK_HASH,
  parent_hash: SAMPLE_PARENT_HASH,
  gas_used: '15000000',
  gas_limit: '30000000',
  base_fee_gwei: 30,
  min_priority_fee_gwei: 1,
  max_priority_fee_gwei: 100,
  avg_priority_fee_gwei: 25,
  median_priority_fee_gwei: 20,
  total_base_fee_gwei: 450000000,
  total_priority_fee_gwei: 375000000,
  tx_count: 150,
  block_time_sec: 2,
  mgas_per_sec: 7.5,
  tps: 75,
  finalized: false,
  finalized_at: null,
  milestone_id: null,
  time_to_finality_sec: null,
};

export const sampleFinalizedBlock: Block = {
  ...sampleBlock,
  finalized: true,
  finalizedAt: new Date('2024-01-15T12:00:30Z'),
  milestoneId: 50000100n,
  timeToFinalitySec: 30,
};

export function createBlock(overrides: Partial<Block> = {}): Block {
  return { ...sampleBlock, ...overrides };
}

export function createBlockRow(overrides: Partial<BlockRow> = {}): BlockRow {
  return { ...sampleBlockRow, ...overrides };
}

export function createBlockBatch(count: number, startBlockNumber = 50000000n): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < count; i++) {
    const blockNumber = startBlockNumber + BigInt(i);
    blocks.push(createBlock({
      blockNumber,
      timestamp: new Date(new Date('2024-01-15T12:00:00Z').getTime() + i * 2000),
      blockHash: `0x${blockNumber.toString(16).padStart(64, '0')}` as `0x${string}`,
    }));
  }
  return blocks;
}

// RPC block format (for mock RPC client)
export interface RpcBlock {
  number: bigint;
  hash: `0x${string}`;
  parentHash: `0x${string}`;
  timestamp: bigint;
  gasUsed: bigint;
  gasLimit: bigint;
  baseFeePerGas: bigint | null;
  transactions: Array<{
    hash: `0x${string}`;
    maxPriorityFeePerGas?: bigint | null;
    gasPrice?: bigint | null;
    gas: bigint;
    gasUsed?: bigint;
  }> | string[];
}

export function createRpcBlock(blockNumber: bigint, overrides: Partial<RpcBlock> = {}): RpcBlock {
  return {
    number: blockNumber,
    hash: `0x${blockNumber.toString(16).padStart(64, '0')}` as `0x${string}`,
    parentHash: `0x${(blockNumber - 1n).toString(16).padStart(64, '0')}` as `0x${string}`,
    timestamp: BigInt(Math.floor(new Date('2024-01-15T12:00:00Z').getTime() / 1000)) + blockNumber,
    gasUsed: 15000000n,
    gasLimit: 30000000n,
    baseFeePerGas: 30000000000n, // 30 gwei
    transactions: [],
    ...overrides,
  };
}
