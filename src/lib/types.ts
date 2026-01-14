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
  sequenceId: number;
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

/**
 * Block data for UI components (serialized for client-side use)
 */
export interface BlockDataUI {
  blockNumber: string;
  timestamp: string;
  gasUsedPercent: number;
  baseFeeGwei: number;
  avgPriorityFeeGwei: number;
  medianPriorityFeeGwei: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  txCount: number;
  gasUsed: string;
  gasLimit: string;
  blockTimeSec?: number | null;
  mgasPerSec?: number | null;
  tps?: number | null;
  totalBaseFeeGwei?: number;
  totalPriorityFeeGwei?: number;
  finalized: boolean;
  timeToFinalitySec: number | null;
}

export interface ChartDataPoint {
  timestamp: number;
  blockStart: number;
  blockEnd: number;
  baseFee: { open: number; high: number; low: number; close: number; avg: number };
  priorityFee: { avg: number; min: number; max: number; median: number; open: number; close: number };
  total: { avg: number; min: number; max: number };
  totalBaseFeeSum: number;
  totalPriorityFeeSum: number;
  gasUsedSum: number;
  gasLimitSum: number;
  mgasPerSec: number;
  tps: number;
  finalityAvg: number | null;
  finalityMin: number | null;
  finalityMax: number | null;
  blockTimeAvg: number | null;
  blockTimeMin: number | null;
  blockTimeMax: number | null;
}

export interface MilestoneChartDataPoint {
  timestamp: number;
  milestoneId: number;
  sequenceId: number;
  blockTimeAvg: number | null;
  blockTimeMin: number | null;
  blockTimeMax: number | null;
}

// Inflation rate data from database
export interface InflationRate {
  id: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  interestPerYearLog2: bigint;
  startSupply: bigint;
  startTimestamp: bigint;
  implementationAddress: string;
  createdAt: Date;
}

// Inflation rate row from database (raw)
export interface InflationRateRow {
  id: number;
  block_number: string;
  block_timestamp: string;
  interest_per_year_log2: string;
  start_supply: string;
  start_timestamp: string;
  implementation_address: string;
  created_at: string;
}

// API response for inflation rates
export interface InflationRateResponse {
  blockNumber: string;
  blockTimestamp: string;
  interestPerYearLog2: string;
  startSupply: string;
  startTimestamp: string;
  implementationAddress: string;
}

// Inflation chart data point (calculated on frontend)
export interface InflationChartDataPoint {
  timestamp: number;
  issuance: number;         // POL issued in this bucket
  netInflation: number;     // issuance - burned
  totalSupply: number;      // Total supply at bucket end
  supplyAtStart: number;    // Supply at start of time range (for % calc)
}

// Table statistics (materialized cache)
export interface TableStats {
  minValue: bigint;
  maxValue: bigint;
  totalCount: bigint;
  finalizedCount: bigint | null;
  minFinalized: bigint | null;
  maxFinalized: bigint | null;
  updatedAt: Date;
}

// Table statistics row from database (raw)
export interface TableStatsRow {
  table_name: string;
  min_value: string;
  max_value: string;
  total_count: string;
  finalized_count: string | null;
  min_finalized: string | null;
  max_finalized: string | null;
  updated_at: Date;
}
