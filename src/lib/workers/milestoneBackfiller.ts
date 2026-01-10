import { getHeimdallClient, HeimdallExhaustedError } from '@/lib/heimdall';
import { insertMilestone, getLowestMilestoneId } from '@/lib/queries/milestones';

const EXHAUSTED_RETRY_MS = 5 * 60 * 1000; // 5 minutes
const DELAY_MS = 500;
const BATCH_SIZE = 50; // Process 50 milestones at a time

export class MilestoneBackfiller {
  private running = false;
  private targetSequenceId: number;
  private currentSequenceId: number | null = null;

  constructor(targetSequenceId = 1) {
    this.targetSequenceId = targetSequenceId;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`[MilestoneBackfiller] Starting backfill to sequence ID ${this.targetSequenceId}`);
    await this.backfill();
  }

  stop(): void {
    this.running = false;
  }

  private async backfill(): Promise<void> {
    const heimdall = getHeimdallClient();

    while (this.running) {
      try {
        // Initialize current sequence ID if not set
        if (this.currentSequenceId === null) {
          // Check what we already have in DB
          const lowestInDb = await getLowestMilestoneId();
          if (lowestInDb !== null) {
            // Continue from where we left off
            this.currentSequenceId = Number(lowestInDb) - 1;
          } else {
            // Start from latest
            const count = await heimdall.getMilestoneCount();
            this.currentSequenceId = count;
          }
          console.log(`[MilestoneBackfiller] Starting from sequence ID ${this.currentSequenceId}`);
        }

        if (this.currentSequenceId < this.targetSequenceId) {
          console.log('[MilestoneBackfiller] Milestone backfill complete!');
          this.running = false;
          return;
        }

        await this.processBatch(heimdall);
        await this.sleep(DELAY_MS);
      } catch (error) {
        if (error instanceof HeimdallExhaustedError) {
          console.error('[MilestoneBackfiller] Heimdall exhausted, waiting 5 minutes...');
          await this.sleep(EXHAUSTED_RETRY_MS);
        } else {
          console.error('[MilestoneBackfiller] Error:', error);
          await this.sleep(5000);
        }
      }
    }
  }

  private async processBatch(heimdall: ReturnType<typeof getHeimdallClient>): Promise<void> {
    if (this.currentSequenceId === null) return;

    const endId = this.currentSequenceId;
    const startId = Math.max(this.targetSequenceId, endId - BATCH_SIZE + 1);

    console.log(`[MilestoneBackfiller] Fetching milestones ${startId} to ${endId}`);

    // Fetch and store milestones - reconciliation will handle block finality
    for (let seqId = endId; seqId >= startId && this.running; seqId--) {
      try {
        const milestone = await heimdall.getMilestone(seqId);

        // Store the milestone - reconciler will match blocks later
        await insertMilestone({
          milestoneId: milestone.milestoneId,
          startBlock: milestone.startBlock,
          endBlock: milestone.endBlock,
          hash: milestone.hash,
          proposer: milestone.proposer,
          timestamp: milestone.timestamp,
        });

        console.log(
          `[MilestoneBackfiller] Stored milestone seq=${seqId} (blocks ${milestone.startBlock}-${milestone.endBlock})`
        );

        await this.sleep(100); // Small delay between milestones
      } catch (error) {
        console.error(`[MilestoneBackfiller] Error fetching milestone seq=${seqId}:`, error);
      }
    }

    this.currentSequenceId = startId - 1;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
