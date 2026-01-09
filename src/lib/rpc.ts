import { createPublicClient, http, PublicClient, Block as ViemBlock, Transaction } from 'viem';
import { polygon } from 'viem/chains';

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
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

  private calculateBackoff(retry: number): number {
    const exponentialDelay = this.retryConfig.baseDelayMs * Math.pow(2, retry);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return Math.min(exponentialDelay + jitter, this.retryConfig.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async call<T>(fn: (client: PublicClient) => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let retry = 0; retry <= this.retryConfig.maxRetries; retry++) {
      for (let attempt = 0; attempt < this.urls.length; attempt++) {
        try {
          return await fn(this.client);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          console.warn(`RPC ${this.urls[this.currentIndex]} failed: ${lastError.message}`);
          this.rotateEndpoint();
        }
      }

      if (retry < this.retryConfig.maxRetries) {
        const delay = this.calculateBackoff(retry);
        console.warn(`All endpoints failed. Retry ${retry + 1}/${this.retryConfig.maxRetries} in ${delay}ms...`);
        await this.sleep(delay);
      }
    }

    throw new RpcExhaustedError(
      `All RPC endpoints failed after ${this.retryConfig.maxRetries} retries`,
      lastError
    );
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return this.call((client) => client.getBlockNumber());
  }

  async getBlock(blockNumber: bigint): Promise<ViemBlock> {
    return this.call((client) =>
      client.getBlock({ blockNumber, includeTransactions: false })
    );
  }

  async getBlockWithTransactions(blockNumber: bigint): Promise<ViemBlock<bigint, boolean, Transaction>> {
    return this.call((client) =>
      client.getBlock({ blockNumber, includeTransactions: true })
    ) as Promise<ViemBlock<bigint, boolean, Transaction>>;
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
