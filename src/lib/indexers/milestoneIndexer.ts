import { getHeimdallClient } from '../heimdall';
import { insertMilestone, getHighestSequenceId, sequenceIdExists } from '../queries/milestones';
import { Milestone } from '../types';
import { getIndexerState, updateIndexerState, initializeIndexerState } from './indexerState';
import { writeFinalityBatch } from './finalityWriter';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from '../workers/workerStatus';
import { sleep } from '../utils';
import { updateTableStats } from '../queries/stats';
import { SequenceCache } from './sequenceCache';

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
  private sequenceCache: SequenceCache;

  constructor() {
    this.pollMs = parseInt(process.env.MILESTONE_POLL_MS || '1000', 10);
    this.batchSize = parseInt(process.env.MILESTONE_BATCH_SIZE || '50', 10);
    this.sequenceCache = new SequenceCache(1000);
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

    // Warm the cache with the current cursor value (the predecessor is known to exist)
    if (this.cursor !== null) {
      this.sequenceCache.add(this.cursor);
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
          const requestedIds = this.range(this.cursor! + 1, this.cursor! + fetchCount);

          // Fetch milestones in parallel
          const milestones = await heimdall.getMilestones(requestedIds);

          // Process with gap detection
          const processed = await this.processWithGapDetection(milestones, requestedIds);

          if (processed > 0) {
            updateWorkerRun(WORKER_NAME, processed);
            console.log(`[${WORKER_NAME}] Processed ${processed} milestones (requested ${requestedIds[0]}-${requestedIds[requestedIds.length - 1]})`);
          }
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
   * Process milestones with gap detection.
   * Ensures no gaps in sequence_ids by validating predecessors exist.
   * Returns number of successfully processed milestones.
   */
  private async processWithGapDetection(
    milestones: Milestone[],
    requestedIds: number[]
  ): Promise<number> {
    // Build set of received sequence_ids
    const receivedIds = new Set(milestones.map(m => m.sequenceId));

    // Check for gaps in the requested range - find first missing ID
    for (const id of requestedIds) {
      if (!receivedIds.has(id)) {
        console.warn(`[${WORKER_NAME}] Gap detected: sequence_id ${id} not returned by API, stopping at cursor ${this.cursor}`);
        // Stop processing - don't advance cursor past the gap
        return 0;
      }
    }

    // Sort by sequence_id to process in order
    milestones.sort((a, b) => a.sequenceId - b.sequenceId);

    let processed = 0;
    for (const milestone of milestones) {
      // Check predecessor exists (cache first, then DB)
      const predecessorId = milestone.sequenceId - 1;
      const predecessorExists = await this.checkPredecessorExists(predecessorId);

      if (!predecessorExists) {
        console.warn(`[${WORKER_NAME}] Predecessor ${predecessorId} missing for sequence_id ${milestone.sequenceId}, stopping`);
        // Stop processing - don't advance cursor past the gap
        break;
      }

      // Process the milestone
      await this.processMilestone(milestone);

      // Add to cache and update cursor
      this.sequenceCache.add(milestone.sequenceId);
      this.cursor = milestone.sequenceId;
      await updateIndexerState(SERVICE_NAME, BigInt(this.cursor), '');
      processed++;
    }

    return processed;
  }

  /**
   * Check if predecessor sequence_id exists (cache first, then DB).
   * For the first milestone (cursor + 1), the cursor itself is the predecessor.
   */
  private async checkPredecessorExists(predecessorId: number): Promise<boolean> {
    // If predecessor is 0 or less, there's no predecessor needed
    if (predecessorId <= 0) {
      return true;
    }

    // Check cache first
    if (this.sequenceCache.has(predecessorId)) {
      return true;
    }

    // Fall back to DB check
    const exists = await sequenceIdExists(predecessorId);
    if (exists) {
      // Add to cache for future lookups
      this.sequenceCache.add(predecessorId);
    }
    return exists;
  }

  /**
   * Process a single milestone.
   */
  private async processMilestone(milestone: Milestone): Promise<void> {
    // Insert milestone into milestones table
    await insertMilestone(milestone);

    // Update table stats for API queries
    await updateTableStats('milestones', BigInt(milestone.sequenceId), BigInt(milestone.sequenceId), 1);

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
