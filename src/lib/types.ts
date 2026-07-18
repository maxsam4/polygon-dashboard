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
  avgPriorityFeeGwei: number | null;  // null when gasUsed not yet available (pending receipt data)
  medianPriorityFeeGwei: number;
  totalBaseFeeGwei: number;
  totalPriorityFeeGwei: number | null;  // null when gasUsed not yet available (pending receipt data)
  txCount: number;
  blockTimeSec: number | null;
  mgasPerSec: number | null;
  tps: number | null;
  finalized: boolean;
  finalizedAt: Date | null;
  milestoneId: bigint | null;
  timeToFinalitySec: number | null;
  gasTargetPct: number | null;
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
  avg_priority_fee_gwei: number | null;  // null when gasUsed not yet available
  median_priority_fee_gwei: number;
  total_base_fee_gwei: number;
  total_priority_fee_gwei: number | null;  // null when gasUsed not yet available
  tx_count: number;
  block_time_sec: number | null;
  mgas_per_sec: number | null;
  tps: number | null;
  finalized: boolean;
  finalized_at: Date | null;
  milestone_id: string | null;
  time_to_finality_sec: number | null;
  gas_target_pct: number | null;
}

/**
 * Block data for UI components (serialized for client-side use)
 */
export interface BlockDataUI {
  blockNumber: string;
  timestamp: string;
  gasUsedPercent: number;
  baseFeeGwei: number;
  avgPriorityFeeGwei: number | null;  // null = pending (receipt data not yet fetched)
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
  totalPriorityFeeGwei?: number | null;  // null = pending (receipt data not yet fetched)
  finalized: boolean;
  timeToFinalitySec: number | null;
  gasTargetPct?: number | null;
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
  gasTargetPctAvg: number | null;
  // USD values are already in USD (converted server-side via pol_prices join);
  // null = no price data for the bucket (pre-history or fetcher outage).
  totalBaseFeeUsdSum: number | null;
  totalPriorityFeeUsdSum: number | null;
  priceUsdAvg: number | null;
}

// POL/MATIC hourly price row (pol_prices table)
export interface PolPrice {
  ts: Date;         // hour start (UTC)
  priceUsd: number; // hourly close
  source: string;   // 'binance:MATICUSDT' | 'binance:POLUSDT' | 'carry_forward'
}

// /api/stats response (aggregate summary over a time range)
export interface SummaryStats {
  range: { from: number; to: number }; // unix seconds, snapped to source bucket boundaries
  source: 'blocks' | 'blocks_1min_agg' | 'blocks_1hour_agg';
  fees: {
    basePol: number;
    priorityPol: number;
    totalPol: number;
    baseUsd: number | null;
    priorityUsd: number | null;
    totalUsd: number | null;
    avgTxFeePol: number | null;
    avgTxFeeUsd: number | null;
    usdMissingHours: number; // hours in range with no price row (partial USD coverage)
  };
  throughput: {
    avgTps: number | null;
    peakTps: number | null;
    peakTpsBlock: number | null; // block that hit the peak (for explorer links)
    avgMgas: number | null;
    peakMgas: number | null;
    peakMgasBlock: number | null;
  };
  blocks: {
    count: number;
    txCount: number;
    avgBlockTimeSec: number | null;
    gasUsedSum: number;
    utilizationPct: number | null;
    blockStart: number | null;
    blockEnd: number | null;
    avgFinalitySec: number | null;
  };
  inflation: {
    issuancePol: number;
    burnedPol: number;
    netInflationPol: number;
    netInflationUsd: number | null;
    netInflationPctOfSupply: number | null;
  } | null; // null when inflation rates unavailable
  priceUsd: number | null; // latest known POL price
}

// Inflation rate data from database
export interface InflationRate {
  id: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  interestPerYearLog2: bigint;
  startSupply: bigint;
  startTimestamp: bigint;
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
  created_at: string;
}

// API response for inflation rates
export interface InflationRateResponse {
  blockNumber: string;
  blockTimestamp: string;
  interestPerYearLog2: string;
  startSupply: string;
  startTimestamp: string;
}

// Inflation chart data point (calculated on frontend)
export interface InflationChartDataPoint {
  timestamp: number;
  issuance: number;         // POL issued in this bucket
  netInflation: number;     // issuance - burned
  supplyAtStart: number;    // Supply at start of time range (for % calc)
}

// Table statistics (materialized cache)
export interface TableStats {
  minValue: bigint | null;  // null when no data exists
  maxValue: bigint | null;  // null when no data exists
  totalCount: bigint;
  finalizedCount: bigint | null;
  minFinalized: bigint | null;
  maxFinalized: bigint | null;
  updatedAt: Date;
}

// Table statistics row from database (raw)
export interface TableStatsRow {
  table_name: string;
  min_value: string | null;  // null when no data exists
  max_value: string | null;  // null when no data exists
  total_count: string;
  finalized_count: string | null;
  min_finalized: string | null;
  max_finalized: string | null;
  updated_at: Date;
}

// Transaction details for block details page (from RPC receipts)
export interface TransactionDetails {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  gasLimit: string;
  gasUsed: string | null;
  gasPrice: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  effectiveGasPrice: string | null;
  nonce: number;
  transactionIndex: number | null;
  status: string | null;  // 'success' or 'reverted'
  type: string;
  input: string;
  contractAddress: string | null;
}

// Block details page response (block from DB + transactions from RPC)
export interface BlockDetailsResponse {
  block: BlockDataUI & {
    blockHash: string;
    parentHash: string;
  };
  transactions: TransactionDetails[];
}
