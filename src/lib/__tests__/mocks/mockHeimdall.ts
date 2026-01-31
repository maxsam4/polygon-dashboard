// Mock Heimdall client for testing

import type { Milestone } from '@/lib/types';

// Configurable responses
const milestoneResponses = new Map<number, Milestone>();
let latestMilestone: Milestone | null = null;
let milestoneCount = 0;
let shouldFail = false;
let failCount = 0;
let maxFailures = 0;

export function resetMockHeimdall(): void {
  milestoneResponses.clear();
  latestMilestone = null;
  milestoneCount = 0;
  shouldFail = false;
  failCount = 0;
  maxFailures = 0;
}

export function setMilestoneResponse(sequenceId: number, milestone: Milestone): void {
  milestoneResponses.set(sequenceId, milestone);
}

export function setLatestMilestone(milestone: Milestone): void {
  latestMilestone = milestone;
}

export function setMilestoneCount(count: number): void {
  milestoneCount = count;
}

export function setFailure(fail: boolean, maxFail = 0): void {
  shouldFail = fail;
  maxFailures = maxFail;
  failCount = 0;
}

function checkFailure(): void {
  if (shouldFail && (maxFailures === 0 || failCount < maxFailures)) {
    failCount++;
    throw new Error('Mock Heimdall failure');
  }
}

// Mock HeimdallClient class
export class MockHeimdallClient {
  private urls: string[];

  constructor(urls: string[]) {
    this.urls = urls;
  }

  get endpointCount(): number {
    return this.urls.length;
  }

  async getLatestMilestone(): Promise<Milestone> {
    checkFailure();
    if (!latestMilestone) {
      throw new Error('No latest milestone configured');
    }
    return latestMilestone;
  }

  async getMilestone(sequenceId: number): Promise<Milestone> {
    checkFailure();
    const milestone = milestoneResponses.get(sequenceId);
    if (!milestone) {
      throw new Error(`Milestone ${sequenceId} not found`);
    }
    return milestone;
  }

  async getMilestones(sequenceIds: number[]): Promise<Milestone[]> {
    const results: Milestone[] = [];
    for (const seqId of sequenceIds) {
      try {
        const milestone = await this.getMilestone(seqId);
        results.push(milestone);
      } catch {
        // Skip failed milestones
      }
    }
    return results;
  }

  async getMilestoneCount(): Promise<number> {
    checkFailure();
    return milestoneCount;
  }
}

export const mockGetHeimdallClient = jest.fn(() => new MockHeimdallClient(['https://heimdall.test.com']));
