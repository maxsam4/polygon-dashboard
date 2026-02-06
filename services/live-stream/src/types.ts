// Block type as received from WebSocket newHeads subscription
export interface RawBlock {
  number: string; // hex
  hash: string;
  parentHash: string;
  timestamp: string; // hex
  gasUsed: string; // hex
  gasLimit: string; // hex
  baseFeePerGas: string; // hex
  transactions: RawTransaction[] | string[]; // full txs or just hashes
}

export interface RawTransaction {
  hash: string;
  from: string;
  to: string | null;
  gas: string; // hex
  gasPrice: string; // hex
  maxFeePerGas?: string; // hex
  maxPriorityFeePerGas?: string; // hex
  value: string; // hex
  input: string;
  nonce: string; // hex
  type: string; // hex
}

// Processed block for SSE streaming
export interface StreamBlock {
  blockNumber: number;
  blockHash: string;
  parentHash: string;
  timestamp: number; // unix seconds
  gasUsed: bigint;
  gasLimit: bigint;
  baseFeeGwei: number;
  txCount: number;
  // Priority fee metrics (calculated from transactions in header)
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  medianPriorityFeeGwei: number;
  // Derived metrics
  blockTimeSec: number | null;
  mgasPerSec: number | null;
  tps: number | null;
  // Receipt-based priority fee metrics (null = pending receipt data)
  avgPriorityFeeGwei: number | null;
  totalPriorityFeeGwei: number | null;
  // Finality data (populated when milestone arrives)
  finalized: boolean;
  finalizedAt: number | null; // unix timestamp
  milestoneId: number | null;
  timeToFinalitySec: number | null;
}

// SSE message types
export interface SSEInitialMessage {
  type: 'initial';
  blocks: StreamBlock[];
}

export interface SSEUpdateMessage {
  type: 'update';
  block: StreamBlock;
}

export interface SSEBlockUpdateMessage {
  type: 'block_update';
  blockNumber: number;
  updates: Partial<StreamBlock>;
}

export type SSEMessage = SSEInitialMessage | SSEUpdateMessage | SSEBlockUpdateMessage;

// Payload for POST /update endpoint
export interface BlockUpdatePayload {
  blockNumber: number;
  // Block metrics
  txCount?: number;
  // Priority fee metrics from receipts
  minPriorityFeeGwei?: number;
  maxPriorityFeeGwei?: number;
  avgPriorityFeeGwei?: number;
  medianPriorityFeeGwei?: number;
  totalPriorityFeeGwei?: number;
  // Finality data
  finalized?: boolean;
  finalizedAt?: number;
  milestoneId?: number;
  timeToFinalitySec?: number;
}

// WebSocket connection state
export interface WSConnectionState {
  url: string;
  connected: boolean;
  lastBlock: number | null;
  lastMessageTime: number | null;
  reconnectAttempts: number;
}
