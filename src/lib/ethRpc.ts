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
  private currentIndex = 0;
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

  private get client(): PublicClient {
    return this.clients[this.currentIndex];
  }

  private rotateEndpoint(): void {
    this.currentIndex = (this.currentIndex + 1) % this.urls.length;
  }

  async call<T>(fn: (client: PublicClient) => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let retry = 0; retry <= this.retryConfig.maxRetries; retry++) {
      for (let attempt = 0; attempt < this.urls.length; attempt++) {
        try {
          return await fn(this.client);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt === 0 && retry === 0) {
            console.warn(`ETH RPC ${this.urls[this.currentIndex]} failed: ${lastError.message}, rotating...`);
          }
          this.rotateEndpoint();
        }
      }

      if (retry < this.retryConfig.maxRetries) {
        await sleep(this.retryConfig.delayMs);
      }
    }

    throw new EthRpcExhaustedError(
      `All Ethereum RPC endpoints failed after ${this.retryConfig.maxRetries} retries`,
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
