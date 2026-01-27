import { createPublicClient, http, webSocket, PublicClient, TransactionReceipt, numberToHex, hexToBigInt } from 'viem';
import { polygon } from 'viem/chains';
import { sleep } from './utils';

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

// Callback type for block subscriptions
export type BlockCallback = (blockNumber: bigint) => void;

interface RetryConfig {
  maxRetries: number;
  delayMs: number; // Fixed delay between retries (no exponential backoff)
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3, // Try each endpoint 3 times
  delayMs: 500,  // 500ms between retry rounds
};

export class RpcExhaustedError extends Error {
  constructor(message: string, public lastError?: Error) {
    super(message);
    this.name = 'RpcExhaustedError';
  }
}

export class RpcClient {
  private urls: string[];
  private clients: PublicClient[];
  private currentIndex = 0;
  private retryConfig: RetryConfig;

  constructor(urls: string[], retryConfig = DEFAULT_RETRY_CONFIG) {
    if (urls.length === 0) {
      throw new Error('At least one RPC URL is required');
    }
    this.urls = urls;
    this.retryConfig = retryConfig;
    this.clients = urls.map((url) =>
      createPublicClient({
        chain: polygon,
        transport: http(url),
      })
    );
  }

  get endpointCount(): number {
    return this.urls.length;
  }

  private get client(): PublicClient {
    return this.clients[this.currentIndex];
  }

  private rotateEndpoint(): void {
    this.currentIndex = (this.currentIndex + 1) % this.urls.length;
  }

  // Get client for a specific endpoint index (for parallel requests)
  private getClientByIndex(index: number): PublicClient {
    return this.clients[index % this.urls.length];
  }

  async call<T>(fn: (client: PublicClient) => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    // Try each endpoint up to maxRetries rounds
    for (let retry = 0; retry <= this.retryConfig.maxRetries; retry++) {
      for (let attempt = 0; attempt < this.urls.length; attempt++) {
        try {
          return await fn(this.client);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          // Only log occasionally to avoid spam
          if (attempt === 0 && retry === 0) {
            console.warn(`RPC ${this.urls[this.currentIndex]} failed: ${lastError.message}, rotating...`);
          }
          this.rotateEndpoint();
        }
      }

      // Small fixed delay between retry rounds
      if (retry < this.retryConfig.maxRetries) {
        await sleep(this.retryConfig.delayMs);
      }
    }

    // Throw error but callers should handle gracefully and retry
    throw new RpcExhaustedError(
      `All RPC endpoints failed after ${this.retryConfig.maxRetries} retries`,
      lastError
    );
  }

  // Execute multiple calls in parallel across ALL endpoints
  async callParallel<T>(fns: ((client: PublicClient) => Promise<T>)[]): Promise<T[]> {
    const results: T[] = [];
    const errors: Error[] = [];

    // Distribute requests across endpoints
    const promises = fns.map(async (fn, i) => {
      const clientIndex = i % this.urls.length;
      let lastError: Error | undefined;

      // Try with retries
      for (let retry = 0; retry <= this.retryConfig.maxRetries; retry++) {
        try {
          return await fn(this.getClientByIndex(clientIndex + retry));
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (retry < this.retryConfig.maxRetries) {
            await sleep(this.retryConfig.delayMs);
          }
        }
      }
      throw lastError;
    });

    const settled = await Promise.allSettled(promises);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        errors.push(result.reason);
      }
    }

    if (errors.length > 0 && results.length === 0) {
      throw new RpcExhaustedError(`All parallel RPC calls failed`, errors[0]);
    }

    return results;
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return this.call((client) => client.getBlockNumber());
  }

  async getBlock(blockNumber: bigint) {
    return this.call((client) =>
      client.getBlock({ blockNumber, includeTransactions: false })
    );
  }

  async getBlockWithTransactions(blockNumber: bigint) {
    return this.call((client) =>
      client.getBlock({ blockNumber, includeTransactions: true })
    );
  }

  // Fetch multiple blocks in parallel across all endpoints
  async getBlocksWithTransactions(blockNumbers: bigint[]): Promise<Map<bigint, Awaited<ReturnType<typeof this.getBlockWithTransactions>>>> {
    const results = new Map<bigint, Awaited<ReturnType<typeof this.getBlockWithTransactions>>>();

    const fns = blockNumbers.map((blockNumber) => (client: PublicClient) =>
      client.getBlock({ blockNumber, includeTransactions: true })
    );

    const blocks = await this.callParallel(fns);

    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i]) {
        results.set(blockNumbers[i], blocks[i]);
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

    const blocks = await this.callParallel(fns);

    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i]) {
        results.set(blockNumbers[i], blocks[i]);
      }
    }

    return results;
  }

  // Fetch transaction receipts for a block using eth_getBlockReceipts RPC method
  async getBlockReceipts(blockNumber: bigint): Promise<TransactionReceipt[] | null> {
    return this.call(async (client) => {
      // eth_getBlockReceipts is not in viem's typed methods, so we use a type assertion
      const result = await (client.request as (args: { method: string; params: unknown[] }) => Promise<unknown>)({
        method: 'eth_getBlockReceipts',
        params: [numberToHex(blockNumber)],
      });
      if (!result || !Array.isArray(result)) return null;
      return (result as RawReceipt[]).map(parseReceipt);
    });
  }

  // Fetch transaction receipts for multiple blocks in parallel
  async getBlocksReceipts(blockNumbers: bigint[]): Promise<Map<bigint, TransactionReceipt[] | null>> {
    const results = new Map<bigint, TransactionReceipt[] | null>();

    const fns = blockNumbers.map((blockNumber) => async (client: PublicClient) => {
      // eth_getBlockReceipts is not in viem's typed methods, so we use a type assertion
      const result = await (client.request as (args: { method: string; params: unknown[] }) => Promise<unknown>)({
        method: 'eth_getBlockReceipts',
        params: [numberToHex(blockNumber)],
      });
      if (!result || !Array.isArray(result)) return null;
      return (result as RawReceipt[]).map(parseReceipt);
    });

    const receipts = await this.callParallel(fns);

    for (let i = 0; i < receipts.length; i++) {
      if (receipts[i]) {
        results.set(blockNumbers[i], receipts[i]);
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
  private reconnectDelayMs = 1000;
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
            delay: 1000,
          },
          keepAlive: {
            interval: 10_000,
          },
        }),
      });

      this.clients.set(url, client);

      // Subscribe to new blocks
      const unsubscribe = await client.watchBlocks({
        onBlock: (block) => {
          // Only process if this is a new block we haven't seen
          if (block.number && block.number > this.lastBlockNumber) {
            this.lastBlockNumber = block.number;
            if (this.callback) {
              this.callback(block.number);
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
