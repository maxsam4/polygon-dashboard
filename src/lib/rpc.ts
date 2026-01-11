import { createPublicClient, http, PublicClient } from 'viem';
import { polygon } from 'viem/chains';
import { sleep } from './utils';

// Re-export Block type for convenience
export type { Block as ViemBlock } from 'viem';

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
