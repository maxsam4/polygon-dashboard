import { Milestone } from './types';
import { sleep } from './utils';

interface RetryConfig {
  maxRetries: number;
  delayMs: number; // Fixed delay between retries (no exponential backoff)
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3, // Try each endpoint 3 times
  delayMs: 500,  // 500ms between retry rounds
};

const FETCH_TIMEOUT_MS = 10_000; // 10s timeout per Heimdall request

interface HeimdallMilestoneResponse {
  milestone: {
    milestone_id: string;
    start_block: string;
    end_block: string;
    hash: string;
    proposer: string;
    bor_chain_id: string;
    timestamp: string;
  };
}

interface HeimdallCountResponse {
  count: string;
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

  private async fetch<T>(path: string): Promise<T> {
    let lastError: Error | undefined;

    // Try each endpoint up to maxRetries rounds
    for (let retry = 0; retry <= this.retryConfig.maxRetries; retry++) {
      for (let attempt = 0; attempt < this.urls.length; attempt++) {
        try {
          const url = `${this.baseUrl}${path}`;
          const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return (await response.json()) as T;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          console.warn(`Heimdall ${this.baseUrl} failed (retry ${retry + 1}/${this.retryConfig.maxRetries + 1}, endpoint ${attempt + 1}/${this.urls.length}): ${lastError.message}`);
          this.rotateEndpoint();
        }
      }

      // Small fixed delay between retry rounds
      if (retry < this.retryConfig.maxRetries) {
        await sleep(this.retryConfig.delayMs);
      }
    }

    console.error(`All ${this.urls.length} Heimdall endpoints failed after ${this.retryConfig.maxRetries + 1} retry rounds`);
    throw new HeimdallExhaustedError(
      `All Heimdall endpoints failed after ${this.retryConfig.maxRetries} retries`,
      lastError
    );
  }

  async getLatestMilestone(): Promise<Milestone> {
    const count = await this.getMilestoneCount();
    const response = await this.fetch<HeimdallMilestoneResponse>('/milestones/latest');
    return this.parseMilestone(response, count);
  }

  async getMilestone(sequenceId: number): Promise<Milestone> {
    const response = await this.fetch<HeimdallMilestoneResponse>(`/milestones/${sequenceId}`);
    return this.parseMilestone(response, sequenceId);
  }

  // Fetch multiple milestones in parallel across all endpoints
  async getMilestones(sequenceIds: number[]): Promise<Milestone[]> {
    const results: Milestone[] = [];

    // Distribute requests across endpoints for true parallelism
    const promises = sequenceIds.map(async (seqId, i) => {
      const endpointIndex = i % this.urls.length;
      let lastError: Error | undefined;

      for (let retry = 0; retry <= this.retryConfig.maxRetries; retry++) {
        try {
          const baseUrl = this.urls[(endpointIndex + retry) % this.urls.length];
          const url = `${baseUrl}/milestones/${seqId}`;
          const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          const data = (await response.json()) as HeimdallMilestoneResponse;
          return this.parseMilestone(data, seqId);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          console.warn(`Heimdall getMilestones(${seqId}) failed (attempt ${retry + 1}/${this.retryConfig.maxRetries + 1}): ${lastError.message}`);
          if (retry < this.retryConfig.maxRetries) {
            await sleep(this.retryConfig.delayMs);
          }
        }
      }
      console.error(`Heimdall getMilestones(${seqId}) failed after all retries`);
      throw lastError;
    });

    const settled = await Promise.allSettled(promises);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }

    return results;
  }

  get endpointCount(): number {
    return this.urls.length;
  }

  async getMilestoneCount(): Promise<number> {
    const response = await this.fetch<HeimdallCountResponse>('/milestones/count');
    return parseInt(response.count, 10);
  }

  private parseMilestone(response: HeimdallMilestoneResponse, sequenceId: number): Milestone {
    const r = response.milestone;
    // Use end_block as the milestone ID for consistency with block references
    const milestoneNumericId = BigInt(r.end_block);
    return {
      milestoneId: milestoneNumericId,
      sequenceId,
      startBlock: BigInt(r.start_block),
      endBlock: BigInt(r.end_block),
      hash: r.hash,
      proposer: r.proposer || null,
      timestamp: new Date(parseInt(r.timestamp, 10) * 1000),
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
