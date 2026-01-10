import { getHeimdallClient, HeimdallExhaustedError } from '@/lib/heimdall';
import { query, getPool } from '@/lib/db';
import { insertMilestone } from '@/lib/queries/milestones';

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
        // Get the current milestone count from Heimdall
        const count = await heimdall.getMilestoneCount();

        // Initialize current sequence ID if not set
        if (this.currentSequenceId === null) {
          // Find where to start - look for gaps in finalized blocks
          const unfinalizedResult = await query<{ min_block: string; max_block: string }>(
            `SELECT MIN(block_number) as min_block, MAX(block_number) as max_block
             FROM blocks WHERE finalized = FALSE`
          );

          if (!unfinalizedResult[0]?.min_block) {
            // No unfinalized blocks, start from latest milestone going backwards
            this.currentSequenceId = count;
          } else {
            // Start from the latest and work backwards to cover unfinalized blocks
            this.currentSequenceId = count;
          }
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

    console.log(`[MilestoneBackfiller] Processing milestones ${startId} to ${endId}`);

    const pool = getPool();
    const client = await pool.connect();

    try {
      // Fetch and process milestones
      for (let seqId = endId; seqId >= startId && this.running; seqId--) {
        try {
          const milestone = await heimdall.getMilestone(seqId);

          // Store the milestone
          await insertMilestone({
            milestoneId: milestone.milestoneId,
            startBlock: milestone.startBlock,
            endBlock: milestone.endBlock,
            hash: milestone.hash,
            proposer: milestone.proposer,
            timestamp: milestone.timestamp,
          });

          // Update blocks finality for this milestone range
          // Only update blocks that exist and are unfinalized
          const result = await client.query<{ block_number: string; timestamp: Date }>(
            `SELECT block_number, timestamp FROM blocks
             WHERE block_number >= $1 AND block_number <= $2 AND finalized = FALSE`,
            [milestone.startBlock.toString(), milestone.endBlock.toString()]
          );

          if (result.rows.length > 0) {
            await client.query('BEGIN');

            for (const row of result.rows) {
              const timeToFinalitySec = (milestone.timestamp.getTime() - row.timestamp.getTime()) / 1000;
              await client.query(
                `UPDATE blocks SET
                  finalized = TRUE,
                  finalized_at = $1,
                  milestone_id = $2,
                  time_to_finality_sec = $3,
                  updated_at = NOW()
                WHERE block_number = $4`,
                [milestone.timestamp, milestone.milestoneId.toString(), timeToFinalitySec, row.block_number]
              );
            }

            await client.query('COMMIT');

            console.log(
              `[MilestoneBackfiller] Milestone seq=${seqId} (blocks ${milestone.startBlock}-${milestone.endBlock}): updated ${result.rows.length} blocks`
            );
          }

          await this.sleep(100); // Small delay between milestones
        } catch (error) {
          console.error(`[MilestoneBackfiller] Error processing milestone seq=${seqId}:`, error);
          try {
            await client.query('ROLLBACK');
          } catch {
            // Ignore rollback errors
          }
        }
      }

      this.currentSequenceId = startId - 1;
    } finally {
      client.release();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
