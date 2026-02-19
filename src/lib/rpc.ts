import { createPublicClient, http, webSocket, PublicClient, TransactionReceipt, numberToHex, hexToBigInt } from 'viem';
import { polygon } from 'viem/chains';
import { sleep, abortableSleep } from './utils';
import { RPC_RETRY_CONFIG } from './constants';
import { recordRpcCall } from './rpcStats';

// Re-export Block type for convenience
export type { Block as ViemBlock } from 'viem';
export type { TransactionReceipt } from 'viem';

// Raw receipt format from eth_getBlockReceipts RPC (hex strings)
interface RawReceipt {
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  blockNumber: string;
  from: string;
  to: string | null;
  cumulativeGasUsed: string;
  gasUsed: string;
  effectiveGasPrice: string;
  contractAddress: string | null;
  logs: unknown[];
  logsBloom: string;
  status: string;
  type: string;
}

// Parse raw receipt to viem-compatible format
function parseReceipt(raw: RawReceipt): TransactionReceipt {
  return {
    transactionHash: raw.transactionHash as `0x${string}`,
    transactionIndex: Number(hexToBigInt(raw.transactionIndex as `0x${string}`)),
    blockHash: raw.blockHash as `0x${string}`,
    blockNumber: hexToBigInt(raw.blockNumber as `0x${string}`),
    from: raw.from as `0x${string}`,
    to: raw.to as `0x${string}` | null,
    cumulativeGasUsed: hexToBigInt(raw.cumulativeGasUsed as `0x${string}`),
    gasUsed: hexToBigInt(raw.gasUsed as `0x${string}`),
    effectiveGasPrice: hexToBigInt(raw.effectiveGasPrice as `0x${string}`),
    contractAddress: raw.contractAddress as `0x${string}` | null,
    logs: raw.logs as TransactionReceipt['logs'],
    logsBloom: raw.logsBloom as `0x${string}`,
    status: raw.status === '0x1' ? 'success' : 'reverted',
    type: raw.type as TransactionReceipt['type'],
    root: undefined,
    blobGasPrice: undefined,
    blobGasUsed: undefined,
  };
}

// Block data from WebSocket subscription
export interface WsBlock {
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
  }>;
}

// Callback type for block subscriptions - passes full block for immediate processing
export type BlockCallback = (block: WsBlock) => void;

interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  // Circuit breaker: skip endpoint for this duration after consecutive failures
  circuitBreakerThreshold: number; // consecutive failures before opening circuit
  circuitBreakerDurationMs: number; // how long to keep circuit open
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: RPC_RETRY_CONFIG.MAX_RETRIES,
  initialDelayMs: RPC_RETRY_CONFIG.DELAY_MS,
  maxDelayMs: 8000,
  circuitBreakerThreshold: 5,
  circuitBreakerDurationMs: 30_000,
};

// Circuit breaker state per endpoint
interface CircuitBreakerState {
  consecutiveFailures: number;
  openUntil: number; // timestamp when circuit closes again
}

export class RpcExhaustedError extends Error {
  constructor(message: string, public lastError?: Error) {
    super(message);
    this.name = 'RpcExhaustedError';
  }
}

export class RpcTimeoutError extends Error {
  constructor(public timeoutMs: number) {
    super(`RPC call timed out after ${timeoutMs}ms`);
    this.name = 'RpcTimeoutError';
  }
}

export class ReceiptsNotAvailableError extends Error {
  constructor(public blockNumber: bigint) {
    super(`Receipts not available for block ${blockNumber}`);
    this.name = 'ReceiptsNotAvailableError';
  }
}

// Stat record emitted after each RPC attempt
export interface RpcStatRecord {
  timestamp: Date;
  endpoint: string;
  method: string;
  success: boolean;
  isTimeout: boolean;
  responseTimeMs: number;
  errorMessage?: string;
}

export type RpcStatListener = (stat: RpcStatRecord) => void;

export class RpcClient {
  private urls: string[];
  private clients: PublicClient[];
  private retryConfig: RetryConfig;
  private circuitBreakers: CircuitBreakerState[];
  private statListener: RpcStatListener | null = null;

  constructor(urls: string[], retryConfig = DEFAULT_RETRY_CONFIG) {
    if (urls.length === 0) {
      throw new Error('At least one RPC URL is required');
    }
    this.urls = urls;
    this.retryConfig = retryConfig;
    this.clients = urls.map((url) =>
      createPublicClient({
        chain: polygon,
        transport: http(url, { timeout: 10_000 }), // backstop — per-call timeout fires first
      })
    );
    this.circuitBreakers = urls.map(() => ({ consecutiveFailures: 0, openUntil: 0 }));
  }

  get endpointCount(): number {
    return this.urls.length;
  }

  set onStat(listener: RpcStatListener | null) {
    this.statListener = listener;
  }

  getEndpointHostname(index: number): string {
    try {
      return new URL(this.urls[index]).hostname;
    } catch {
      return this.urls[index];
    }
  }

  private emitRpcStat(endpointIndex: number, method: string | undefined, success: boolean, isTimeout: boolean, responseTimeMs: number, errorMessage?: string): void {
    if (!this.statListener) return;
    this.statListener({
      timestamp: new Date(),
      endpoint: this.getEndpointHostname(endpointIndex),
      method: method ?? 'unknown',
      success,
      isTimeout,
      responseTimeMs,
      errorMessage,
    });
  }

  private getClientByIndex(index: number): PublicClient {
    return this.clients[index % this.urls.length];
  }

  private isCircuitOpen(endpointIndex: number): boolean {
    const cb = this.circuitBreakers[endpointIndex];
    return cb.consecutiveFailures >= this.retryConfig.circuitBreakerThreshold
      && Date.now() < cb.openUntil;
  }

  private recordSuccess(endpointIndex: number): void {
    this.circuitBreakers[endpointIndex].consecutiveFailures = 0;
  }

  private recordFailure(endpointIndex: number): void {
    const cb = this.circuitBreakers[endpointIndex];
    cb.consecutiveFailures++;
    if (cb.consecutiveFailures >= this.retryConfig.circuitBreakerThreshold) {
      cb.openUntil = Date.now() + this.retryConfig.circuitBreakerDurationMs;
      console.warn(`RPC circuit breaker OPEN for ${this.urls[endpointIndex]} (${cb.consecutiveFailures} consecutive failures, skipping for ${this.retryConfig.circuitBreakerDurationMs / 1000}s)`);
    }
  }

  private getBackoffDelay(retry: number): number {
    return Math.min(
      this.retryConfig.initialDelayMs * Math.pow(2, retry),
      this.retryConfig.maxDelayMs
    );
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new RpcTimeoutError(timeoutMs)), timeoutMs);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
  }

  // Shared retry-with-fallback logic used by both call() and callParallel()
  private async retryWithFallback<T>(fn: (client: PublicClient) => Promise<T>, methodName?: string): Promise<T> {
    let lastError: Error | undefined;
    const timeoutMs = RPC_RETRY_CONFIG.CALL_TIMEOUT_MS;

    for (let endpointIndex = 0; endpointIndex < this.urls.length; endpointIndex++) {
      // Skip endpoints with open circuit breaker
      if (this.isCircuitOpen(endpointIndex)) {
        continue;
      }

      const client = this.getClientByIndex(endpointIndex);

      for (let retry = 0; retry <= this.retryConfig.maxRetries; retry++) {
        const startTime = Date.now();
        try {
          const result = await this.withTimeout(fn(client), timeoutMs);
          this.recordSuccess(endpointIndex);
          this.emitRpcStat(endpointIndex, methodName, true, false, Date.now() - startTime);
          return result;
        } catch (error) {
          const elapsed = Date.now() - startTime;
          const isTimeout = error instanceof RpcTimeoutError;
          lastError = error instanceof Error ? error : new Error(String(error));
          this.recordFailure(endpointIndex);
          this.emitRpcStat(endpointIndex, methodName, false, isTimeout, elapsed, lastError.message);
          console.warn(`RPC ${this.urls[endpointIndex]} failed (attempt ${retry + 1}/${this.retryConfig.maxRetries + 1}): ${lastError.message}`);
          if (retry < this.retryConfig.maxRetries) {
            await sleep(this.getBackoffDelay(retry));
          }
        }
      }

      if (endpointIndex < this.urls.length - 1) {
        console.warn(`RPC ${this.urls[endpointIndex]} exhausted retries, falling back to next endpoint`);
      }
    }

    console.error(`All ${this.urls.length} RPC endpoints failed`);
    throw new RpcExhaustedError(
      `All RPC endpoints failed after retries`,
      lastError
    );
  }

  // Primary-first strategy: try first endpoint with retries, then fall back to others
  async call<T>(fn: (client: PublicClient) => Promise<T>, methodName?: string): Promise<T> {
    return this.retryWithFallback(fn, methodName);
  }

  // Execute multiple calls in parallel using primary-first strategy
  // Returns array with null for failed requests (preserves indices)
  async callParallel<T>(fns: ((client: PublicClient) => Promise<T>)[], methodName?: string): Promise<(T | null)[]> {
    const errors: Error[] = [];

    const promises = fns.map(fn => this.retryWithFallback(fn, methodName));

    const settled = await Promise.allSettled(promises);
    const results: (T | null)[] = [];

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push(null);
        errors.push(result.reason);
      }
    }

    if (errors.length > 0 && results.every(r => r === null)) {
      throw new RpcExhaustedError(`All parallel RPC calls failed`, errors[0]);
    }

    return results;
  }

  // Indefinite round-robin retry: cycles through endpoints until success or abort.
  // After a full cycle with all endpoints skipped/failed, waits ROUND_ROBIN_CYCLE_DELAY_MS.
  private async retryRoundRobin<T>(fn: (client: PublicClient) => Promise<T>, signal: AbortSignal, methodName?: string): Promise<T> {
    let lastError: Error | undefined;
    const timeoutMs = RPC_RETRY_CONFIG.CALL_TIMEOUT_MS;

    while (!signal.aborted) {
      let anyAttempted = false;

      for (let i = 0; i < this.urls.length; i++) {
        if (signal.aborted) break;

        if (this.isCircuitOpen(i)) continue;

        anyAttempted = true;
        const client = this.getClientByIndex(i);
        const startTime = Date.now();

        try {
          const result = await this.withTimeout(fn(client), timeoutMs);
          this.recordSuccess(i);
          this.emitRpcStat(i, methodName, true, false, Date.now() - startTime);
          return result;
        } catch (error) {
          const elapsed = Date.now() - startTime;
          const isTimeout = error instanceof RpcTimeoutError;
          lastError = error instanceof Error ? error : new Error(String(error));
          this.recordFailure(i);
          this.emitRpcStat(i, methodName, false, isTimeout, elapsed, lastError.message);
          console.warn(`RPC round-robin ${this.urls[i]} failed: ${lastError.message}`);
        }
      }

      if (signal.aborted) break;

      // Only wait if all endpoints had open circuit breakers (nothing was attempted)
      if (!anyAttempted) {
        console.warn('RPC round-robin: all endpoints have open circuit breakers, waiting...');
        await abortableSleep(RPC_RETRY_CONFIG.ROUND_ROBIN_CYCLE_DELAY_MS, signal);
      }
    }

    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }

  // Fetch receipts for multiple blocks with indefinite round-robin retry per block.
  // Guarantees ALL requested block numbers are present in the returned Map.
  async getBlocksReceiptsReliably(blockNumbers: bigint[], signal: AbortSignal): Promise<Map<bigint, TransactionReceipt[]>> {
    const results = new Map<bigint, TransactionReceipt[]>();

    const promises = blockNumbers.map(async (blockNumber) => {
      const receipts = await this.retryRoundRobin(async (client) => {
        const result = await (client.request as (args: { method: string; params: unknown[] }) => Promise<unknown>)({
          method: 'eth_getBlockReceipts',
          params: [numberToHex(blockNumber)],
        });
        if (!result || !Array.isArray(result)) {
          throw new ReceiptsNotAvailableError(blockNumber);
        }
        if (result.length === 0) {
          // Verify the block actually has 0 transactions before accepting empty receipts
          const block = await client.getBlock({ blockNumber });
          if (block.transactions.length > 0) {
            throw new ReceiptsNotAvailableError(blockNumber);
          }
          return [];
        }
        return (result as RawReceipt[]).map(parseReceipt);
      }, signal, 'eth_getBlockReceipts');

      results.set(blockNumber, receipts);
    });

    await Promise.all(promises);
    return results;
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return this.call((client) => client.getBlockNumber(), 'eth_blockNumber');
  }

  async getBlock(blockNumber: bigint) {
    return this.call((client) =>
      client.getBlock({ blockNumber, includeTransactions: false }),
      'eth_getBlockByNumber'
    );
  }

  async getBlockWithTransactions(blockNumber: bigint) {
    return this.call((client) =>
      client.getBlock({ blockNumber, includeTransactions: true }),
      'eth_getBlockByNumber'
    );
  }

  // Fetch multiple blocks in parallel across all endpoints
  async getBlocksWithTransactions(blockNumbers: bigint[]): Promise<Map<bigint, Awaited<ReturnType<typeof this.getBlockWithTransactions>>>> {
    const results = new Map<bigint, Awaited<ReturnType<typeof this.getBlockWithTransactions>>>();

    const fns = blockNumbers.map((blockNumber) => (client: PublicClient) =>
      client.getBlock({ blockNumber, includeTransactions: true })
    );

    const blocks = await this.callParallel(fns, 'eth_getBlockByNumber');

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block !== null) {
        results.set(blockNumbers[i], block);
      }
    }

    return results;
  }

  // Fetch multiple blocks (without transactions) in parallel
  async getBlocks(blockNumbers: bigint[]): Promise<Map<bigint, Awaited<ReturnType<typeof this.getBlock>>>> {
    const results = new Map<bigint, Awaited<ReturnType<typeof this.getBlock>>>();

    const fns = blockNumbers.map((blockNumber) => (client: PublicClient) =>
      client.getBlock({ blockNumber, includeTransactions: false })
    );

    const blocks = await this.callParallel(fns, 'eth_getBlockByNumber');

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block !== null) {
        results.set(blockNumbers[i], block);
      }
    }

    return results;
  }

  // Fetch transaction receipts for a block using eth_getBlockReceipts RPC method
  // Throws ReceiptsNotAvailableError if receipts not ready (triggers endpoint fallback)
  async getBlockReceipts(blockNumber: bigint): Promise<TransactionReceipt[]> {
    return this.call(async (client) => {
      // eth_getBlockReceipts is not in viem's typed methods, so we use a type assertion
      const result = await (client.request as (args: { method: string; params: unknown[] }) => Promise<unknown>)({
        method: 'eth_getBlockReceipts',
        params: [numberToHex(blockNumber)],
      });
      if (!result || !Array.isArray(result)) {
        // Throw to trigger retry on next endpoint
        throw new ReceiptsNotAvailableError(blockNumber);
      }
      return (result as RawReceipt[]).map(parseReceipt);
    }, 'eth_getBlockReceipts');
  }

  // Fetch transaction receipts for multiple blocks in parallel
  // Each block independently retries across all endpoints before giving up
  async getBlocksReceipts(blockNumbers: bigint[]): Promise<Map<bigint, TransactionReceipt[]>> {
    const results = new Map<bigint, TransactionReceipt[]>();

    const fns = blockNumbers.map((blockNumber) => async (client: PublicClient) => {
      // eth_getBlockReceipts is not in viem's typed methods, so we use a type assertion
      const result = await (client.request as (args: { method: string; params: unknown[] }) => Promise<unknown>)({
        method: 'eth_getBlockReceipts',
        params: [numberToHex(blockNumber)],
      });
      if (!result || !Array.isArray(result)) {
        // Throw to trigger retry on next endpoint
        throw new ReceiptsNotAvailableError(blockNumber);
      }
      return (result as RawReceipt[]).map(parseReceipt);
    });

    const receipts = await this.callParallel(fns, 'eth_getBlockReceipts');

    for (let i = 0; i < receipts.length; i++) {
      const receipt = receipts[i];
      if (receipt !== null) {
        results.set(blockNumbers[i], receipt);
      }
    }

    return results;
  }
}

let rpcClient: RpcClient | null = null;

export function getRpcClient(): RpcClient {
  if (!rpcClient) {
    const urls = process.env.POLYGON_RPC_URLS?.split(',').map((s) => s.trim()).filter(Boolean);
    if (!urls || urls.length === 0) {
      throw new Error('POLYGON_RPC_URLS environment variable is required');
    }
    rpcClient = new RpcClient(urls);
    rpcClient.onStat = recordRpcCall;
  }
  return rpcClient;
}

/**
 * Manages WebSocket subscriptions to multiple RPC endpoints for new blocks.
 * Keeps all subscriptions active and reconnects on errors.
 */
export class BlockSubscriptionManager {
  private wsUrls: string[];
  private clients: Map<string, PublicClient> = new Map();
  private unsubscribes: Map<string, () => void> = new Map();
  private callback: BlockCallback | null = null;
  private running = false;
  private reconnectDelayMs = RPC_RETRY_CONFIG.RECONNECT_DELAY_MS;
  private lastBlockNumber: bigint = 0n;

  constructor(wsUrls: string[]) {
    this.wsUrls = wsUrls;
  }

  /**
   * Start subscriptions to all WebSocket endpoints.
   * Calls the callback whenever a new block is detected from ANY endpoint.
   */
  start(callback: BlockCallback): void {
    if (this.running) return;
    this.running = true;
    this.callback = callback;

    console.log(`[BlockSubscriptionManager] Starting subscriptions to ${this.wsUrls.length} WebSocket endpoints`);

    for (const url of this.wsUrls) {
      this.connectAndSubscribe(url);
    }
  }

  /**
   * Stop all subscriptions.
   */
  stop(): void {
    this.running = false;
    this.callback = null;

    // Unsubscribe from all
    for (const [url, unsubscribe] of this.unsubscribes) {
      try {
        unsubscribe();
        console.log(`[BlockSubscriptionManager] Unsubscribed from ${url}`);
      } catch {
        // Ignore unsubscribe errors
      }
    }
    this.unsubscribes.clear();
    this.clients.clear();
  }

  private async connectAndSubscribe(url: string): Promise<void> {
    if (!this.running) return;

    try {
      // Create WebSocket client with auto-reconnect
      const client = createPublicClient({
        chain: polygon,
        transport: webSocket(url, {
          reconnect: {
            attempts: Infinity, // Keep trying forever
            delay: RPC_RETRY_CONFIG.RECONNECT_DELAY_MS,
          },
          keepAlive: {
            interval: RPC_RETRY_CONFIG.RECONNECT_INTERVAL_MS,
          },
        }),
      });

      this.clients.set(url, client);

      // Subscribe to new blocks with full transaction data for immediate processing
      const unsubscribe = await client.watchBlocks({
        includeTransactions: true,
        onBlock: (block) => {
          // Guard against undefined block or block.number (can happen with some endpoints)
          if (!block || block.number === undefined || block.number === null) {
            return;
          }
          // Only process if this is a new block we haven't seen
          if (block.number > this.lastBlockNumber) {
            this.lastBlockNumber = block.number;
            if (this.callback) {
              // Pass full block data for immediate processing
              const wsBlock: WsBlock = {
                number: block.number,
                hash: block.hash,
                parentHash: block.parentHash,
                timestamp: block.timestamp,
                gasUsed: block.gasUsed,
                gasLimit: block.gasLimit,
                baseFeePerGas: block.baseFeePerGas ?? null,
                transactions: (block.transactions as Array<{
                  hash: `0x${string}`;
                  maxPriorityFeePerGas?: bigint | null;
                  gasPrice?: bigint | null;
                  gas: bigint;
                }>).map(tx => ({
                  hash: tx.hash,
                  maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
                  gasPrice: tx.gasPrice,
                  gas: tx.gas,
                })),
              };
              this.callback(wsBlock);
            }
          }
        },
        onError: (error) => {
          console.error(`[BlockSubscriptionManager] Block watch error on ${url}:`, error);
          // viem's reconnect handles reconnection, but schedule a backup reconnect
          this.scheduleReconnect(url);
        },
      });

      this.unsubscribes.set(url, unsubscribe);
      console.log(`[BlockSubscriptionManager] Subscribed to ${url}`);
    } catch (error) {
      console.error(`[BlockSubscriptionManager] Failed to connect to ${url}:`, error);
      this.scheduleReconnect(url);
    }
  }

  private scheduleReconnect(url: string): void {
    if (!this.running) return;

    // Clean up existing subscription
    const existingUnsubscribe = this.unsubscribes.get(url);
    if (existingUnsubscribe) {
      try {
        existingUnsubscribe();
      } catch {
        // Ignore
      }
      this.unsubscribes.delete(url);
    }
    this.clients.delete(url);

    // Schedule reconnect
    setTimeout(() => {
      if (this.running) {
        console.log(`[BlockSubscriptionManager] Reconnecting to ${url}...`);
        this.connectAndSubscribe(url);
      }
    }, this.reconnectDelayMs);
  }
}

let blockSubscriptionManager: BlockSubscriptionManager | null = null;

export function getBlockSubscriptionManager(): BlockSubscriptionManager | null {
  if (!blockSubscriptionManager) {
    const wsUrls = process.env.POLYGON_WS_URLS?.split(',').map((s) => s.trim()).filter(Boolean);
    if (!wsUrls || wsUrls.length === 0) {
      // No WebSocket URLs configured, return null
      return null;
    }
    blockSubscriptionManager = new BlockSubscriptionManager(wsUrls);
  }
  return blockSubscriptionManager;
}
