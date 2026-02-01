import { createPublicClient, http, PublicClient, Log } from 'viem';
import { mainnet } from 'viem/chains';
import { ETH_RPC_URLS } from './constants';
import { sleep } from './utils';

interface RetryConfig {
  maxRetries: number;
  delayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  delayMs: 500,
};

export class EthRpcExhaustedError extends Error {
  constructor(message: string, public lastError?: Error) {
    super(message);
    this.name = 'EthRpcExhaustedError';
  }
}

export class EthRpcClient {
  private urls: string[];
  private clients: PublicClient[];
  private retryConfig: RetryConfig;

  constructor(urls: string[], retryConfig = DEFAULT_RETRY_CONFIG) {
    if (urls.length === 0) {
      throw new Error('At least one Ethereum RPC URL is required');
    }
    this.urls = urls;
    this.retryConfig = retryConfig;
    this.clients = urls.map((url) =>
      createPublicClient({
        chain: mainnet,
        transport: http(url),
      })
    );
  }

  // Get client for a specific endpoint index
  private getClientByIndex(index: number): PublicClient {
    return this.clients[index % this.urls.length];
  }

  // Primary-first strategy: try first endpoint with retries, then fall back to others
  async call<T>(fn: (client: PublicClient) => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    // Try each endpoint in order (primary first)
    for (let endpointIndex = 0; endpointIndex < this.urls.length; endpointIndex++) {
      const client = this.getClientByIndex(endpointIndex);

      // Try this endpoint up to maxRetries times
      for (let retry = 0; retry <= this.retryConfig.maxRetries; retry++) {
        try {
          return await fn(client);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          // Log on first failure of primary endpoint
          if (endpointIndex === 0 && retry === 0) {
            console.warn(`ETH RPC ${this.urls[endpointIndex]} failed: ${lastError.message}, retrying...`);
          }
          // Delay before retry (but not after last retry on this endpoint)
          if (retry < this.retryConfig.maxRetries) {
            await sleep(this.retryConfig.delayMs);
          }
        }
      }

      // All retries exhausted on this endpoint, try next one
      if (endpointIndex < this.urls.length - 1) {
        console.warn(`ETH RPC ${this.urls[endpointIndex]} exhausted retries, falling back to ${this.urls[endpointIndex + 1]}`);
      }
    }

    throw new EthRpcExhaustedError(
      `All Ethereum RPC endpoints failed after ${this.retryConfig.maxRetries} retries each`,
      lastError
    );
  }

  async getBlockNumber(): Promise<bigint> {
    return this.call((client) => client.getBlockNumber());
  }

  async getBlock(blockNumber: bigint) {
    return this.call((client) => client.getBlock({ blockNumber }));
  }

  async readContract<T>(params: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    blockNumber?: bigint;
  }): Promise<T> {
    return this.call((client) =>
      client.readContract(params) as Promise<T>
    );
  }

  async getLogs(params: {
    address: `0x${string}`;
    event: unknown;
    fromBlock: bigint;
    toBlock: bigint | 'latest';
  }): Promise<Log[]> {
    return this.call((client) =>
      client.getLogs(params as Parameters<typeof client.getLogs>[0])
    );
  }
}

let ethRpcClient: EthRpcClient | null = null;

export function getEthRpcClient(): EthRpcClient {
  if (!ethRpcClient) {
    if (ETH_RPC_URLS.length === 0) {
      throw new Error('No Ethereum RPC URLs configured');
    }
    ethRpcClient = new EthRpcClient(ETH_RPC_URLS);
  }
  return ethRpcClient;
}
