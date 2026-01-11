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

  private get client(): PublicClient {
    return this.clients[this.currentIndex];
  }

  private rotateEndpoint(): void {
    this.currentIndex = (this.currentIndex + 1) % this.urls.length;
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
