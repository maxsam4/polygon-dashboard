import { query } from '../db';
import { Milestone } from '../types';
import { pushBlockUpdates } from '../liveStreamClient';
import { UI_CONSTANTS } from '../constants';

/**
 * Write finality data for all blocks in a milestone range to the block_finality table.
 * Also updates the blocks table for blocks that exist.
 *
 * Uses INSERT ... ON CONFLICT to handle idempotent writes.
 * Calculates time_to_finality_sec via JOIN with blocks table if block exists.
 */
export async function writeFinalityBatch(milestone: Milestone): Promise<number> {
  // Generate block numbers in range
  const blockNumbers: string[] = [];
  for (let b = milestone.startBlock; b <= milestone.endBlock; b++) {
    blockNumbers.push(b.toString());
  }

  // Bulk insert into block_finality
  // time_to_finality_sec computed via JOIN with blocks table if block exists
  const result = await query<{ count: string }>(
    `WITH inserted AS (
      INSERT INTO block_finality (block_number, milestone_id, finalized_at, time_to_finality_sec, created_at)
      SELECT
        bn.block_number,
        $1,
        $2,
        CASE WHEN b.timestamp IS NOT NULL
             THEN EXTRACT(EPOCH FROM ($2::timestamptz - b.timestamp))
             ELSE NULL
        END,
        NOW()
      FROM unnest($3::bigint[]) AS bn(block_number)
      LEFT JOIN blocks b ON b.block_number = bn.block_number
      ON CONFLICT (block_number) DO UPDATE SET
        -- Only update time_to_finality_sec if it was NULL and we now have block data
        time_to_finality_sec = CASE
          WHEN block_finality.time_to_finality_sec IS NULL AND EXCLUDED.time_to_finality_sec IS NOT NULL
          THEN EXCLUDED.time_to_finality_sec
          ELSE block_finality.time_to_finality_sec
        END
      RETURNING 1
    )
    SELECT COUNT(*) as count FROM inserted`,
    [milestone.milestoneId.toString(), milestone.timestamp, blockNumbers]
  );

  const inserted = parseInt(result[0]?.count ?? '0', 10);

  // Also update the blocks table for existing blocks (for backward compatibility)
  // This allows existing queries on blocks.finalized to work
  await updateBlocksFinality(milestone);

  // Push finality updates to live-stream service for recent blocks
  // The live-stream ring buffer only holds ~25-30 blocks, so only push updates
  // for blocks that might still be in the buffer
  await pushFinalityUpdatesToLiveStream(milestone);

  return inserted;
}

/**
 * Push finality updates to the live-stream service for blocks that might be in the ring buffer.
 * The ring buffer typically holds ~25-30 recent blocks.
 */
async function pushFinalityUpdatesToLiveStream(milestone: Milestone): Promise<void> {
  // Get the approximate current block number from the milestone's end block
  // We only push updates for blocks within ~30 of the milestone's end block
  // since older blocks are evicted from the live-stream ring buffer
  const recentThreshold = milestone.endBlock - BigInt(UI_CONSTANTS.RING_BUFFER_SIZE);

  const payloads = [];
  const finalizedAt = Math.floor(milestone.timestamp.getTime() / 1000);

  for (let blockNum = milestone.startBlock; blockNum <= milestone.endBlock; blockNum++) {
    // Only push for blocks that might still be in the ring buffer
    if (blockNum >= recentThreshold) {
      // We can't calculate timeToFinalitySec without the block timestamp,
      // but the live-stream already has block data, so just mark as finalized
      payloads.push({
        blockNumber: Number(blockNum),
        finalized: true,
        finalizedAt,
        milestoneId: Number(milestone.milestoneId),
        // timeToFinalitySec will be calculated by the client from block.timestamp and finalizedAt
      });
    }
  }

  if (payloads.length > 0) {
    await pushBlockUpdates(payloads);
  }
}

/**
 * Update finality data in the blocks table for blocks within a milestone range.
 * Only updates blocks that exist and are not yet finalized.
 */
async function updateBlocksFinality(milestone: Milestone): Promise<number> {
  // Use timestamp threshold to avoid scanning compressed chunks
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - 10); // 10 days ago

  const result = await query<{ count: string }>(
    `WITH updated AS (
      UPDATE blocks
      SET
        finalized = TRUE,
        finalized_at = $1,
        milestone_id = $2,
        time_to_finality_sec = EXTRACT(EPOCH FROM ($1::timestamptz - timestamp)),
        updated_at = NOW()
      WHERE block_number BETWEEN $3 AND $4
        AND finalized = FALSE
        AND timestamp >= $5
      RETURNING 1
    )
    SELECT COUNT(*) as count FROM updated`,
    [
      milestone.timestamp,
      milestone.milestoneId.toString(),
      milestone.startBlock.toString(),
      milestone.endBlock.toString(),
      threshold,
    ]
  );

  return parseInt(result[0]?.count ?? '0', 10);
}


