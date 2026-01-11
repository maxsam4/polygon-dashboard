import { getHeimdallClient, HeimdallExhaustedError } from '@/lib/heimdall';
import {
  insertMilestonesBatch,
  reconcileBlocksForMilestones,
  getHighestSequenceId,
} from '@/lib/queries/milestones';
import { Milestone } from '@/lib/types';
import { sleep } from '@/lib/utils';

const POLL_INTERVAL_MS = 2000; // 2 seconds
const EXHAUSTED_RETRY_MS = 5000; // 5 seconds - keep trying, don't wait long
const BATCH_SIZE = 20; // Fetch 20 milestones in parallel
const CATCHUP_BATCH_SIZE = 50; // Larger batches when catching up

export class MilestonePoller {
  private running = false;
  private lastSequenceId: number | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Initialize from database - get highest sequence ID we have
    this.lastSequenceId = await getHighestSequenceId();
    console.log(`[MilestonePoller] Starting from sequence ID ${this.lastSequenceId ?? 'none'}`);

    this.poll();
  }

  stop(): void {
    this.running = false;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const processed = await this.checkNewMilestones();
        // If we processed a full batch, there might be more - don't wait
        if (processed < CATCHUP_BATCH_SIZE) {
          await sleep(POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (error instanceof HeimdallExhaustedError) {
          console.error('[MilestonePoller] Heimdall exhausted, retrying in 5s...');
          await sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[MilestonePoller] Error:', error);
          await sleep(POLL_INTERVAL_MS);
        }
      }
    }
  }

  private async checkNewMilestones(): Promise<number> {
    const heimdall = getHeimdallClient();
    const currentCount = await heimdall.getMilestoneCount();

    // If we don't have a last sequence ID, start from current
    if (this.lastSequenceId === null) {
      this.lastSequenceId = currentCount;
      const latestMilestone = await heimdall.getLatestMilestone();
      await insertMilestonesBatch([latestMilestone]);
      await reconcileBlocksForMilestones([latestMilestone]);
      console.log(`[MilestonePoller] Initialized with milestone ${latestMilestone.milestoneId}`);
      return 1;
    }

    // Check if there are new milestones
    const gap = currentCount - this.lastSequenceId;
    if (gap <= 0) {
      return 0;
    }

    // Determine batch size based on gap
    const batchSize = gap > BATCH_SIZE ? CATCHUP_BATCH_SIZE : BATCH_SIZE;
    const endSeqId = Math.min(this.lastSequenceId + batchSize, currentCount);
    const startSeqId = this.lastSequenceId + 1;

    console.log(`[MilestonePoller] Fetching milestones ${startSeqId} to ${endSeqId} (gap: ${gap})`);

    // Fetch milestones in parallel
    const seqIds = [];
    for (let i = startSeqId; i <= endSeqId; i++) {
      seqIds.push(i);
    }

    const fetchPromises = seqIds.map(async (seqId) => {
      try {
        return await heimdall.getMilestone(seqId);
      } catch {
        console.warn(`[MilestonePoller] Failed to fetch milestone ${seqId}, will retry`);
        return null;
      }
    });

    const results = await Promise.all(fetchPromises);
    const milestones = results.filter((m): m is Milestone => m !== null);

    if (milestones.length === 0) {
      return 0;
    }

    // Sort by sequence ID to ensure order
    milestones.sort((a, b) => a.sequenceId - b.sequenceId);

    // Insert all milestones in batch
    await insertMilestonesBatch(milestones);

    // Reconcile blocks for all milestones in batch
    const reconciled = await reconcileBlocksForMilestones(milestones);

    // Update lastSequenceId to the highest successfully fetched
    const maxFetched = Math.max(...milestones.map(m => m.sequenceId));

    // Only advance if we got all milestones up to maxFetched without gaps
    const fetchedSet = new Set(milestones.map(m => m.sequenceId));
    let newLastSeqId = this.lastSequenceId;
    for (let i = startSeqId; i <= maxFetched; i++) {
      if (fetchedSet.has(i)) {
        newLastSeqId = i;
      } else {
        break; // Gap found, stop here
      }
    }
    this.lastSequenceId = newLastSeqId;

    console.log(
      `[MilestonePoller] Processed ${milestones.length} milestones (${milestones[0].startBlock}-${milestones[milestones.length - 1].endBlock}), reconciled ${reconciled} blocks`
    );

    return milestones.length;
  }
}
