import { getHeimdallClient } from '../heimdall';
import { insertMilestone, getHighestSequenceId } from '../queries/milestones';
import { Milestone } from '../types';
import { getIndexerState, updateIndexerState, initializeIndexerState } from './indexerState';
import { writeFinalityBatch } from './finalityWriter';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from '../workers/workerStatus';
import { sleep } from '../utils';

const SERVICE_NAME = 'milestone_indexer';
const WORKER_NAME = 'MilestoneIndexer';

/**
 * Milestone Indexer - Cursor-based milestone indexer that writes to block_finality.
 *
 * Features:
 * - Cursor-based: Tracks last processed sequence_id for reliable resumption
 * - Gap-free: Processes milestones in sequence order
 * - Writes finality: Inserts finality data for all blocks in milestone range
 */
export class MilestoneIndexer {
  private cursor: number | null = null; // sequence_id
  private running = false;
  private pollMs: number;
  private batchSize: number;

  constructor() {
    this.pollMs = parseInt(process.env.MILESTONE_POLL_MS || '1000', 10);
    this.batchSize = parseInt(process.env.MILESTONE_BATCH_SIZE || '50', 10);
  }

  /**
   * Start the milestone indexer.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    initWorkerStatus(WORKER_NAME);
    updateWorkerState(WORKER_NAME, 'running');

    console.log(`[${WORKER_NAME}] Starting milestone indexer`);
    console.log(`[${WORKER_NAME}] Poll interval: ${this.pollMs}ms, Batch size: ${this.batchSize}`);

    // Load cursor from DB
    const state = await getIndexerState(SERVICE_NAME);

    if (state) {
      // Reuse blockNumber field for sequence_id
      this.cursor = Number(state.blockNumber);
      console.log(`[${WORKER_NAME}] Resumed from sequence_id ${this.cursor}`);
    } else {
      // Try to get the highest sequence_id from milestones table
      const highestSeqId = await getHighestSequenceId();

      if (highestSeqId !== null) {
        // Resume from existing data
        this.cursor = highestSeqId;
        await initializeIndexerState(SERVICE_NAME, BigInt(this.cursor), '');
        console.log(`[${WORKER_NAME}] Initialized from existing milestones at sequence_id ${this.cursor}`);
      } else {
        // Start from current milestone count
        const heimdall = getHeimdallClient();
        const count = await heimdall.getMilestoneCount();
        this.cursor = count;
        await initializeIndexerState(SERVICE_NAME, BigInt(this.cursor), '');
        console.log(`[${WORKER_NAME}] Initialized at current milestone count: ${this.cursor}`);
      }
    }

    // Start main loop
    this.runLoop();
  }

  /**
   * Stop the milestone indexer.
   */
  stop(): void {
    this.running = false;
    updateWorkerState(WORKER_NAME, 'stopped');
    console.log(`[${WORKER_NAME}] Stopped`);
  }

  /**
   * Main indexing loop.
   */
  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const heimdall = getHeimdallClient();
        const count = await heimdall.getMilestoneCount();

        if (count > this.cursor!) {
          // Calculate how many milestones to fetch
          const fetchCount = Math.min(count - this.cursor!, this.batchSize);
          const sequenceIds = this.range(this.cursor! + 1, this.cursor! + fetchCount);

          // Fetch milestones in parallel
          const milestones = await heimdall.getMilestones(sequenceIds);

          // Sort by sequence_id to process in order
          milestones.sort((a, b) => a.sequenceId - b.sequenceId);

          // Process each milestone
          for (const milestone of milestones) {
            await this.processMilestone(milestone);

            // Update cursor after each milestone
            this.cursor = milestone.sequenceId;
            await updateIndexerState(SERVICE_NAME, BigInt(this.cursor), '');
          }

          updateWorkerRun(WORKER_NAME, milestones.length);
          console.log(`[${WORKER_NAME}] Processed ${milestones.length} milestones (seq ${sequenceIds[0]}-${sequenceIds[sequenceIds.length - 1]})`);
        }

        // Wait before checking again
        await sleep(this.pollMs);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[${WORKER_NAME}] Error:`, errorMsg);
        updateWorkerError(WORKER_NAME, errorMsg);
        await sleep(this.pollMs);
      }
    }
  }

  /**
   * Process a single milestone.
   */
  private async processMilestone(milestone: Milestone): Promise<void> {
    // Insert milestone into milestones table
    await insertMilestone(milestone);

    // Write finality data for all blocks in range
    const blocksUpdated = await writeFinalityBatch(milestone);

    console.log(`[${WORKER_NAME}] Milestone seq=${milestone.sequenceId} blocks=${milestone.startBlock}-${milestone.endBlock} finality_records=${blocksUpdated}`);
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
let milestoneIndexerInstance: MilestoneIndexer | null = null;

/**
 * Get the singleton MilestoneIndexer instance.
 */
export function getMilestoneIndexer(): MilestoneIndexer {
  if (!milestoneIndexerInstance) {
    milestoneIndexerInstance = new MilestoneIndexer();
  }
  return milestoneIndexerInstance;
}
