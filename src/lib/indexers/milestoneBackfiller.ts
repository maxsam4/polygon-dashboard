import { getHeimdallClient } from '../heimdall';
import { insertMilestonesBatch, getLowestSequenceId } from '../queries/milestones';
import { getIndexerState, updateIndexerState, initializeIndexerState } from './indexerState';
import { writeFinalityBatch } from './finalityWriter';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from '../workers/workerStatus';
import { sleep } from '../utils';
import { updateTableStats } from '../queries/stats';
import { env } from '../env';

const SERVICE_NAME = 'milestone_backfiller';
const WORKER_NAME = 'MilestoneBackfiller';

/**
 * Milestone Backfiller - Backwards indexing from lowest sequence_id to target.
 *
 * Features:
 * - Separate cursor: Independent from forward indexer
 * - Backwards indexing: Works from current lowest sequence_id down to target
 * - Writes finality: Inserts finality data for all blocks in milestone ranges
 */
export class MilestoneBackfiller {
  private cursor: number | null = null; // Current lowest indexed sequence_id
  private targetSequence: number;
  private running = false;
  private batchSize: number;
  private delayMs: number;

  constructor() {
    this.targetSequence = env.milestoneBackfillToSequence;
    this.batchSize = env.milestoneBackfillBatchSize;
    this.delayMs = parseInt(process.env.MILESTONE_BACKFILL_DELAY_MS || '500', 10);
  }

  /**
   * Start the milestone backfiller.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    initWorkerStatus(WORKER_NAME);
    updateWorkerState(WORKER_NAME, 'running');

    console.log(`[${WORKER_NAME}] Starting milestone backfiller`);
    console.log(`[${WORKER_NAME}] Target sequence: ${this.targetSequence}, Batch size: ${this.batchSize}`);

    // Load cursor from DB
    const state = await getIndexerState(SERVICE_NAME);

    if (state) {
      // Reuse blockNumber field for sequence_id
      this.cursor = Number(state.blockNumber);
      console.log(`[${WORKER_NAME}] Resumed from sequence_id ${this.cursor}`);
    } else {
      // Start from lowest sequence_id in DB
      const lowestSeqId = await getLowestSequenceId();

      if (lowestSeqId !== null) {
        this.cursor = lowestSeqId;
        await initializeIndexerState(SERVICE_NAME, BigInt(this.cursor), '');
        console.log(`[${WORKER_NAME}] Initialized from lowest sequence_id ${this.cursor}`);
      } else {
        // No milestones in DB yet, wait for forward indexer to start
        console.log(`[${WORKER_NAME}] No milestones in DB yet, waiting...`);
        updateWorkerState(WORKER_NAME, 'idle');
        await this.waitForMilestones();
      }
    }

    // Check if already complete
    if (this.cursor && this.cursor <= this.targetSequence) {
      console.log(`[${WORKER_NAME}] Backfill already complete! (lowest=${this.cursor}, target=${this.targetSequence})`);
      updateWorkerState(WORKER_NAME, 'idle');
      return;
    }

    // Start main loop
    this.runLoop();
  }

  /**
   * Stop the milestone backfiller.
   */
  stop(): void {
    this.running = false;
    updateWorkerState(WORKER_NAME, 'stopped');
    console.log(`[${WORKER_NAME}] Stopped`);
  }

  /**
   * Wait for the forward indexer to populate some milestones.
   */
  private async waitForMilestones(): Promise<void> {
    while (this.running) {
      const lowestSeqId = await getLowestSequenceId();
      if (lowestSeqId !== null) {
        this.cursor = lowestSeqId;
        await initializeIndexerState(SERVICE_NAME, BigInt(this.cursor), '');
        console.log(`[${WORKER_NAME}] Found milestones, starting from sequence_id ${this.cursor}`);
        updateWorkerState(WORKER_NAME, 'running');
        return;
      }
      await sleep(5000); // Check every 5 seconds
    }
  }

  /**
   * Main backfilling loop.
   */
  private async runLoop(): Promise<void> {
    while (this.running && this.cursor! > this.targetSequence) {
      try {
        // Calculate sequence range to fetch (going backwards)
        const endSeqId = this.cursor! - 1;
        const startSeqIdRaw = endSeqId - this.batchSize + 1;
        const startSeqId = startSeqIdRaw < this.targetSequence ? this.targetSequence : startSeqIdRaw;

        // Skip if nothing to fetch
        if (endSeqId < this.targetSequence) {
          break;
        }

        // Fetch milestones from Heimdall
        const sequenceIds = this.range(startSeqId, endSeqId);
        const heimdall = getHeimdallClient();
        const milestones = await heimdall.getMilestones(sequenceIds);

        if (milestones.length === 0) {
          console.warn(`[${WORKER_NAME}] No milestones returned for range ${startSeqId}-${endSeqId}`);
          await sleep(this.delayMs);
          continue;
        }

        // Sort by sequence_id ascending
        milestones.sort((a, b) => a.sequenceId - b.sequenceId);

        // Insert milestones into DB
        await insertMilestonesBatch(milestones);

        // Write finality data for each milestone
        for (const milestone of milestones) {
          await writeFinalityBatch(milestone);
        }

        // Update cursor to the lowest sequence_id we just processed
        const lowestMilestone = milestones[0];
        await updateIndexerState(SERVICE_NAME, BigInt(lowestMilestone.sequenceId), '');
        this.cursor = lowestMilestone.sequenceId;

        // Update table stats for API queries
        const highestMilestone = milestones[milestones.length - 1];
        await updateTableStats('milestones', BigInt(lowestMilestone.sequenceId), BigInt(highestMilestone.sequenceId), milestones.length);

        updateWorkerRun(WORKER_NAME, milestones.length);

        const remaining = this.cursor - this.targetSequence;
        console.log(`[${WORKER_NAME}] Backfilled ${milestones.length} milestones (seq ${startSeqId}-${endSeqId}), remaining: ${remaining}`);

        // Small delay to avoid overwhelming the Heimdall API
        await sleep(this.delayMs);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[${WORKER_NAME}] Error:`, errorMsg);
        updateWorkerError(WORKER_NAME, errorMsg);
        await sleep(this.delayMs * 10); // Longer delay on error
      }
    }

    if (this.cursor && this.cursor <= this.targetSequence) {
      console.log(`[${WORKER_NAME}] Backfill complete! Reached target sequence ${this.targetSequence}`);
      updateWorkerState(WORKER_NAME, 'idle');
    }
  }

  /**
   * Generate an array of sequence IDs in a range.
   */
  private range(start: number, end: number): number[] {
    const result: number[] = [];
    for (let i = start; i <= end; i++) {
      result.push(i);
    }
    return result;
  }
}

// Singleton instance
let milestoneBackfillerInstance: MilestoneBackfiller | null = null;

/**
 * Get the singleton MilestoneBackfiller instance.
 */
export function getMilestoneBackfiller(): MilestoneBackfiller {
  if (!milestoneBackfillerInstance) {
    milestoneBackfillerInstance = new MilestoneBackfiller();
  }
  return milestoneBackfillerInstance;
}
