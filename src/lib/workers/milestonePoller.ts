import { getHeimdallClient, HeimdallExhaustedError } from '@/lib/heimdall';
import {
  insertMilestone,
  reconcileBlocksForMilestone,
  getHighestSequenceId,
} from '@/lib/queries/milestones';

const POLL_INTERVAL_MS = 2500; // 2.5 seconds
const EXHAUSTED_RETRY_MS = 5 * 60 * 1000; // 5 minutes

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
        await this.checkNewMilestones();
        await this.sleep(POLL_INTERVAL_MS);
      } catch (error) {
        if (error instanceof HeimdallExhaustedError) {
          console.error('[MilestonePoller] Heimdall exhausted, waiting 5 minutes...');
          await this.sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[MilestonePoller] Error:', error);
          await this.sleep(POLL_INTERVAL_MS);
        }
      }
    }
  }

  private async checkNewMilestones(): Promise<void> {
    const heimdall = getHeimdallClient();
    const currentCount = await heimdall.getMilestoneCount();

    // If we don't have a last sequence ID, start from current
    if (this.lastSequenceId === null) {
      this.lastSequenceId = currentCount;
      const latestMilestone = await heimdall.getLatestMilestone();
      await this.processMilestone(latestMilestone);
      return;
    }

    // Check if there are new milestones
    if (currentCount > this.lastSequenceId) {
      // Fetch all missing milestones in order
      for (let seqId = this.lastSequenceId + 1; seqId <= currentCount && this.running; seqId++) {
        try {
          const milestone = await heimdall.getMilestone(seqId);
          await this.processMilestone(milestone);
          this.lastSequenceId = seqId;
        } catch (error) {
          console.error(`[MilestonePoller] Error fetching milestone seq=${seqId}:`, error);
          // Don't update lastSequenceId so we retry this one next time
          break;
        }
      }
    }
  }

  private async processMilestone(milestone: {
    milestoneId: bigint;
    sequenceId: number;
    startBlock: bigint;
    endBlock: bigint;
    hash: string;
    proposer: string | null;
    timestamp: Date;
  }): Promise<void> {
    // Store milestone
    await insertMilestone(milestone);

    // Reconcile blocks for this milestone
    const updatedCount = await reconcileBlocksForMilestone(milestone);

    console.log(
      `[MilestonePoller] Milestone ${milestone.milestoneId}: blocks ${milestone.startBlock}-${milestone.endBlock}, reconciled ${updatedCount} blocks`
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
