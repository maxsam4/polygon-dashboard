import { getHeimdallClient, HeimdallExhaustedError } from '@/lib/heimdall';
import { insertMilestonesBatch, getLowestSequenceId } from '@/lib/queries/milestones';
import { sleep } from '@/lib/utils';
import { Milestone } from '@/lib/types';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from './workerStatus';

const WORKER_NAME = 'MilestoneBackfiller';
const EXHAUSTED_RETRY_MS = 5000; // 5 seconds - keep trying, don't wait long
const DELAY_MS = 200; // Reduced delay since we're batching
const BASE_BATCH_SIZE = 100; // Base batch size, multiplied by endpoint count

export class MilestoneBackfiller {
  private running = false;
  private targetBlock: bigint;
  private currentSequenceId: number | null = null;

  constructor(targetBlock: bigint) {
    this.targetBlock = targetBlock;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    initWorkerStatus(WORKER_NAME);
    updateWorkerState(WORKER_NAME, 'running');

    console.log(`[MilestoneBackfiller] Starting backfill to block ${this.targetBlock}`);
    this.backfill();
  }

  stop(): void {
    this.running = false;
    updateWorkerState(WORKER_NAME, 'stopped');
  }

  private async backfill(): Promise<void> {
    const heimdall = getHeimdallClient();

    while (this.running) {
      try {
        updateWorkerState(WORKER_NAME, 'running');
        // Initialize current sequence ID if not set
        if (this.currentSequenceId === null) {
          // Check what we already have in DB
          const lowestInDb = await getLowestSequenceId();
          if (lowestInDb !== null) {
            // Continue from where we left off
            this.currentSequenceId = lowestInDb - 1;
          } else {
            // Start from latest
            const count = await heimdall.getMilestoneCount();
            this.currentSequenceId = count;
          }
          console.log(`[MilestoneBackfiller] Starting from sequence ID ${this.currentSequenceId} (${heimdall.endpointCount} endpoints)`);
        }

        if (this.currentSequenceId < 1) {
          console.log('[MilestoneBackfiller] Milestone backfill complete!');
          updateWorkerState(WORKER_NAME, 'idle');
          this.running = false;
          return;
        }

        const processed = await this.processBatch(heimdall);
        if (processed > 0) {
          updateWorkerRun(WORKER_NAME, processed);
        }
        await sleep(DELAY_MS);
      } catch (error) {
        if (error instanceof HeimdallExhaustedError) {
          console.error('[MilestoneBackfiller] Heimdall exhausted, waiting...');
          updateWorkerError(WORKER_NAME, 'Heimdall exhausted');
          await sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[MilestoneBackfiller] Error:', error);
          updateWorkerError(WORKER_NAME, error instanceof Error ? error.message : 'Unknown error');
          await sleep(5000);
        }
      }
    }
  }

  private async processBatch(heimdall: ReturnType<typeof getHeimdallClient>): Promise<number> {
    if (this.currentSequenceId === null) return 0;

    // Scale batch size by endpoint count for better parallelism
    const batchSize = BASE_BATCH_SIZE * heimdall.endpointCount;
    const endId = this.currentSequenceId;
    const startId = Math.max(1, endId - batchSize + 1);

    console.log(`[MilestoneBackfiller] Fetching milestones ${startId} to ${endId} (batch of ${endId - startId + 1})`);

    // Build list of sequence IDs to fetch
    const seqIds: number[] = [];
    for (let seqId = startId; seqId <= endId; seqId++) {
      seqIds.push(seqId);
    }

    // Fetch all milestones in parallel across all endpoints
    const milestones = await heimdall.getMilestones(seqIds);

    if (milestones.length === 0) {
      console.warn('[MilestoneBackfiller] No milestones fetched, retrying...');
      return 0;
    }

    // Sort by sequence ID descending to check target block
    milestones.sort((a, b) => a.sequenceId - b.sequenceId);

    // Check if any milestone is before target block
    const beforeTarget = milestones.filter(m => m.endBlock < this.targetBlock);
    const toInsert = milestones.filter(m => m.endBlock >= this.targetBlock);

    if (beforeTarget.length > 0) {
      console.log(`[MilestoneBackfiller] Reached target block ${this.targetBlock}, stopping backfill`);
      this.running = false;
    }

    // Batch insert all valid milestones
    if (toInsert.length > 0) {
      const milestoneData: Milestone[] = toInsert.map(m => ({
        milestoneId: m.milestoneId,
        sequenceId: m.sequenceId,
        startBlock: m.startBlock,
        endBlock: m.endBlock,
        hash: m.hash,
        proposer: m.proposer,
        timestamp: m.timestamp,
      }));

      await insertMilestonesBatch(milestoneData);
      console.log(`[MilestoneBackfiller] Stored ${toInsert.length} milestones (seq ${startId}-${endId})`);
      this.currentSequenceId = startId - 1;
      return toInsert.length;
    }

    this.currentSequenceId = startId - 1;
    return 0;
  }
}
