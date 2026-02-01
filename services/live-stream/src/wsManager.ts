import WebSocket from 'ws';
import type { RawBlock, RawTransaction, StreamBlock, WSConnectionState } from './types.js';
import { RingBuffer } from './ringBuffer.js';

const GWEI = 1e9;
const MGAS = 1e6;

// Reconnect backoff: 1s, 2s, 4s, 8s, 16s, max 30s
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

type BlockCallback = (block: StreamBlock) => void;

export class WSManager {
  private urls: string[];
  private connections: Map<string, WebSocket> = new Map();
  private connectionStates: Map<string, WSConnectionState> = new Map();
  private ringBuffer: RingBuffer;
  private onNewBlock: BlockCallback | null = null;
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(urls: string[], ringBuffer: RingBuffer) {
    this.urls = urls;
    this.ringBuffer = ringBuffer;

    for (const url of urls) {
      this.connectionStates.set(url, {
        url,
        connected: false,
        lastBlock: null,
        reconnectAttempts: 0,
      });
    }
  }

  /**
   * Set callback for new blocks.
   */
  setBlockCallback(callback: BlockCallback): void {
    this.onNewBlock = callback;
  }

  /**
   * Connect to all WebSocket endpoints.
   */
  async connectAll(): Promise<void> {
    for (const url of this.urls) {
      this.connect(url);
    }
  }

  /**
   * Connect to a single WebSocket endpoint.
   */
  private connect(url: string): void {
    const state = this.connectionStates.get(url)!;

    try {
      const ws = new WebSocket(url);

      ws.on('open', () => {
        console.log(`[WS] Connected to ${url}`);
        state.connected = true;
        state.reconnectAttempts = 0;

        // Subscribe to newHeads with full transaction objects
        const subscribeMsg = {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_subscribe',
          params: ['newHeads'],
        };
        ws.send(JSON.stringify(subscribeMsg));
      });

      ws.on('message', (data) => {
        this.handleMessage(url, data.toString());
      });

      ws.on('close', () => {
        console.log(`[WS] Disconnected from ${url}`);
        state.connected = false;
        this.connections.delete(url);
        this.scheduleReconnect(url);
      });

      ws.on('error', (err) => {
        console.error(`[WS] Error on ${url}:`, err.message);
        // Close event will trigger reconnect
      });

      this.connections.set(url, ws);
    } catch (err) {
      console.error(`[WS] Failed to connect to ${url}:`, err);
      this.scheduleReconnect(url);
    }
  }

  /**
   * Schedule reconnection with exponential backoff.
   */
  private scheduleReconnect(url: string): void {
    const state = this.connectionStates.get(url)!;
    state.reconnectAttempts++;

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(2, state.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY
    );

    console.log(`[WS] Reconnecting to ${url} in ${delay}ms (attempt ${state.reconnectAttempts})`);

    // Clear any existing timer
    const existingTimer = this.reconnectTimers.get(url);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(url);
      this.connect(url);
    }, delay);

    this.reconnectTimers.set(url, timer);
  }

  /**
   * Handle incoming WebSocket message.
   */
  private handleMessage(url: string, data: string): void {
    try {
      const msg = JSON.parse(data);

      // Subscription confirmation
      if (msg.id === 1 && msg.result) {
        console.log(`[WS] Subscribed on ${url}, subscription ID: ${msg.result}`);
        return;
      }

      // New block notification
      if (msg.method === 'eth_subscription' && msg.params?.result) {
        const rawBlock = msg.params.result as RawBlock;
        this.processBlock(url, rawBlock);
      }
    } catch (err) {
      console.error(`[WS] Failed to parse message from ${url}:`, err);
    }
  }

  /**
   * Process a new block from WebSocket.
   */
  private processBlock(url: string, raw: RawBlock): void {
    const blockNumber = parseInt(raw.number, 16);
    const state = this.connectionStates.get(url)!;
    state.lastBlock = blockNumber;

    // Convert raw block to StreamBlock
    const timestamp = parseInt(raw.timestamp, 16);
    const gasUsed = BigInt(raw.gasUsed);
    const gasLimit = BigInt(raw.gasLimit);
    const baseFeeWei = BigInt(raw.baseFeePerGas || '0');
    const baseFeeGwei = Number(baseFeeWei) / GWEI;

    // Calculate priority fees from transactions
    const { min, max, median } = this.calculatePriorityFees(raw.transactions, baseFeeWei);

    // Calculate block time from previous block in buffer
    const blockTimeSec = this.ringBuffer.calculateBlockTime(blockNumber, timestamp);

    // Calculate throughput metrics
    let mgasPerSec: number | null = null;
    let tps: number | null = null;
    const txCount = Array.isArray(raw.transactions) ? raw.transactions.length : 0;

    if (blockTimeSec && blockTimeSec > 0) {
      mgasPerSec = Number(gasUsed) / MGAS / blockTimeSec;
      tps = txCount / blockTimeSec;
    }

    const block: StreamBlock = {
      blockNumber,
      blockHash: raw.hash,
      parentHash: raw.parentHash,
      timestamp,
      gasUsed,
      gasLimit,
      baseFeeGwei,
      txCount,
      minPriorityFeeGwei: min,
      maxPriorityFeeGwei: max,
      medianPriorityFeeGwei: median,
      blockTimeSec,
      mgasPerSec,
      tps,
      // Receipt-based metrics (null = pending, populated by indexer)
      avgPriorityFeeGwei: null,
      totalPriorityFeeGwei: null,
      // Finality data (populated when milestone arrives)
      finalized: false,
      finalizedAt: null,
      milestoneId: null,
      timeToFinalitySec: null,
    };

    // Add to ring buffer (deduplicates)
    const added = this.ringBuffer.push(block);

    if (added && this.onNewBlock) {
      console.log(`[WS] New block #${blockNumber} from ${url}`);
      this.onNewBlock(block);
    }
  }

  /**
   * Calculate min/max/median priority fees from transactions.
   */
  private calculatePriorityFees(
    transactions: RawTransaction[] | string[],
    baseFeeWei: bigint
  ): { min: number; max: number; median: number } {
    // If transactions are just hashes, we can't calculate priority fees
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return { min: 0, max: 0, median: 0 };
    }

    if (typeof transactions[0] === 'string') {
      return { min: 0, max: 0, median: 0 };
    }

    const priorityFees: number[] = [];

    for (const tx of transactions as RawTransaction[]) {
      let priorityFeeWei: bigint;

      if (tx.maxPriorityFeePerGas) {
        // EIP-1559 transaction
        const maxPriorityFee = BigInt(tx.maxPriorityFeePerGas);
        const maxFee = BigInt(tx.maxFeePerGas || '0');
        // Effective priority fee is min(maxPriorityFee, maxFee - baseFee)
        const effectivePriority = maxFee > baseFeeWei
          ? (maxPriorityFee < maxFee - baseFeeWei ? maxPriorityFee : maxFee - baseFeeWei)
          : 0n;
        priorityFeeWei = effectivePriority;
      } else if (tx.gasPrice) {
        // Legacy transaction
        const gasPrice = BigInt(tx.gasPrice);
        priorityFeeWei = gasPrice > baseFeeWei ? gasPrice - baseFeeWei : 0n;
      } else {
        continue;
      }

      priorityFees.push(Number(priorityFeeWei) / GWEI);
    }

    if (priorityFees.length === 0) {
      return { min: 0, max: 0, median: 0 };
    }

    priorityFees.sort((a, b) => a - b);

    const min = priorityFees[0];
    const max = priorityFees[priorityFees.length - 1];
    const mid = Math.floor(priorityFees.length / 2);
    const median = priorityFees.length % 2 === 0
      ? (priorityFees[mid - 1] + priorityFees[mid]) / 2
      : priorityFees[mid];

    return { min, max, median };
  }

  /**
   * Get connection status for health checks.
   */
  getStatus(): { connected: number; total: number; states: WSConnectionState[] } {
    const states = Array.from(this.connectionStates.values());
    const connected = states.filter(s => s.connected).length;
    return {
      connected,
      total: this.urls.length,
      states,
    };
  }

  /**
   * Check if at least one connection is active.
   */
  isConnected(): boolean {
    return Array.from(this.connectionStates.values()).some(s => s.connected);
  }

  /**
   * Disconnect all WebSocket connections.
   */
  disconnectAll(): void {
    for (const [url, ws] of this.connections) {
      ws.close();
      this.connections.delete(url);
    }

    for (const [url, timer] of this.reconnectTimers) {
      clearTimeout(timer);
      this.reconnectTimers.delete(url);
    }
  }
}
