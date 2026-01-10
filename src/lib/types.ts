export interface Block {
  blockNumber: bigint;
  timestamp: Date;
  blockHash: string;
  parentHash: string;
  gasUsed: bigint;
  gasLimit: bigint;
  baseFeeGwei: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  avgPriorityFeeGwei: number;
  medianPriorityFeeGwei: number;
  totalBaseFeeGwei: number;
  totalPriorityFeeGwei: number;
  txCount: number;
  blockTimeSec: number | null;
  mgasPerSec: number | null;
  tps: number | null;
  finalized: boolean;
  finalizedAt: Date | null;
  milestoneId: bigint | null;
  timeToFinalitySec: number | null;
}

export interface Milestone {
  milestoneId: bigint;
  startBlock: bigint;
  endBlock: bigint;
  hash: string;
  proposer: string | null;
  timestamp: Date;
}

export interface MilestoneWithStats extends Milestone {
  blocksInDb: number;
  avgFinalityTime: number | null;
}

export interface BlockRow {
  timestamp: Date;
  block_number: string;
  block_hash: string;
  parent_hash: string;
  gas_used: string;
  gas_limit: string;
  base_fee_gwei: number;
  min_priority_fee_gwei: number;
  max_priority_fee_gwei: number;
  avg_priority_fee_gwei: number;
  median_priority_fee_gwei: number;
  total_base_fee_gwei: number;
  total_priority_fee_gwei: number;
  tx_count: number;
  block_time_sec: number | null;
  mgas_per_sec: number | null;
  tps: number | null;
  finalized: boolean;
  finalized_at: Date | null;
  milestone_id: string | null;
  time_to_finality_sec: number | null;
}

export interface ChartDataPoint {
  timestamp: number;
  blockStart: number;
  blockEnd: number;
  baseFee: { open: number; high: number; low: number; close: number; avg: number };
  priorityFee: { avg: number; min: number; max: number; median: number; open: number; close: number };
  total: { avg: number; min: number; max: number };
  mgasPerSec: number;
  tps: number;
  finalityAvg: number | null;
  finalityMin: number | null;
  finalityMax: number | null;
}
