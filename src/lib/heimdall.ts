import { Milestone } from './types';

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

interface HeimdallMilestoneResponse {
  result: {
    id: number;
    start_block: number;
    end_block: number;
    hash: string;
    proposer: string;
    bor_chain_id: string;
    timestamp: number;
  };
}

interface HeimdallCountResponse {
  result: {
    count: number;
  };
}

export class HeimdallExhaustedError extends Error {
  constructor(message: string, public lastError?: Error) {
    super(message);
    this.name = 'HeimdallExhaustedError';
  }
}

export class HeimdallClient {
  private urls: string[];
  private currentIndex = 0;
  private retryConfig: RetryConfig;

  constructor(urls: string[], retryConfig = DEFAULT_RETRY_CONFIG) {
    if (urls.length === 0) {
      throw new Error('At least one Heimdall API URL is required');
    }
    this.urls = urls;
    this.retryConfig = retryConfig;
  }

  private get baseUrl(): string {
    return this.urls[this.currentIndex];
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

  private async fetch<T>(path: string): Promise<T> {
    let lastError: Error | undefined;

    for (let retry = 0; retry <= this.retryConfig.maxRetries; retry++) {
      for (let attempt = 0; attempt < this.urls.length; attempt++) {
        try {
          const url = `${this.baseUrl}${path}`;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return (await response.json()) as T;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          console.warn(`Heimdall ${this.baseUrl} failed: ${lastError.message}`);
          this.rotateEndpoint();
        }
      }

      if (retry < this.retryConfig.maxRetries) {
        const delay = this.calculateBackoff(retry);
        console.warn(`All Heimdall endpoints failed. Retry ${retry + 1}/${this.retryConfig.maxRetries} in ${delay}ms...`);
        await this.sleep(delay);
      }
    }

    throw new HeimdallExhaustedError(
      `All Heimdall endpoints failed after ${this.retryConfig.maxRetries} retries`,
      lastError
    );
  }

  async getLatestMilestone(): Promise<Milestone> {
    const response = await this.fetch<HeimdallMilestoneResponse>('/milestone/latest');
    return this.parseMilestone(response);
  }

  async getMilestone(id: number): Promise<Milestone> {
    const response = await this.fetch<HeimdallMilestoneResponse>(`/milestone/${id}`);
    return this.parseMilestone(response);
  }

  async getMilestoneCount(): Promise<number> {
    const response = await this.fetch<HeimdallCountResponse>('/milestone/count');
    return response.result.count;
  }

  private parseMilestone(response: HeimdallMilestoneResponse): Milestone {
    const r = response.result;
    return {
      milestoneId: BigInt(r.id),
      startBlock: BigInt(r.start_block),
      endBlock: BigInt(r.end_block),
      hash: r.hash,
      proposer: r.proposer || null,
      timestamp: new Date(r.timestamp * 1000),
    };
  }
}

let heimdallClient: HeimdallClient | null = null;

export function getHeimdallClient(): HeimdallClient {
  if (!heimdallClient) {
    const urls = process.env.HEIMDALL_API_URLS?.split(',').map((s) => s.trim()).filter(Boolean);
    if (!urls || urls.length === 0) {
      heimdallClient = new HeimdallClient(['https://heimdall-api.polygon.technology']);
    } else {
      heimdallClient = new HeimdallClient(urls);
    }
  }
  return heimdallClient;
}
