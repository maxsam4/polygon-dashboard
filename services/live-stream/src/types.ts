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
  // Priority fee metrics (calculated from transactions)
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  medianPriorityFeeGwei: number;
  // Derived metrics
  blockTimeSec: number | null;
  mgasPerSec: number | null;
  tps: number | null;
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

export type SSEMessage = SSEInitialMessage | SSEUpdateMessage;

// WebSocket connection state
export interface WSConnectionState {
  url: string;
  connected: boolean;
  lastBlock: number | null;
  reconnectAttempts: number;
}
