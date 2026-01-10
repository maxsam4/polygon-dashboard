import { getHeimdallClient, HeimdallExhaustedError } from '@/lib/heimdall';
import {
  getLatestMilestone,
  insertMilestone,
  reconcileBlocksForMilestone,
} from '@/lib/queries/milestones';

const POLL_INTERVAL_MS = 2500; // 2.5 seconds
const EXHAUSTED_RETRY_MS = 5 * 60 * 1000; // 5 minutes

export class MilestonePoller {
  private running = false;
  private lastMilestoneId: bigint | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Initialize from database
    const latestMilestone = await getLatestMilestone();
    this.lastMilestoneId = latestMilestone?.milestoneId ?? null;
    console.log(`[MilestonePoller] Starting from milestone ${this.lastMilestoneId?.toString() ?? 'none'}`);

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
    const latestMilestone = await heimdall.getLatestMilestone();

    if (this.lastMilestoneId === null || latestMilestone.milestoneId > this.lastMilestoneId) {
      // Process new milestone
      await this.processMilestone(latestMilestone);
      this.lastMilestoneId = latestMilestone.milestoneId;
    }
  }

  private async processMilestone(milestone: {
    milestoneId: bigint;
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
