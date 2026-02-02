import { query } from '../db';
import { Milestone } from '../types';
import { pushBlockUpdates } from '../liveStreamClient';
import { UI_CONSTANTS } from '../constants';

/**
 * Write finality data for all blocks in a milestone range to the block_finality table.
 * Also updates the blocks table for blocks that exist.
 *
 * Uses INSERT ... ON CONFLICT to handle idempotent writes.
 * Calculates time_to_finality_sec by first fetching block timestamps via indexed lookup,
 * then batch inserting without JOIN (avoids full table scan).
 */
export async function writeFinalityBatch(milestone: Milestone): Promise<number> {
  // Generate block numbers in range
  const blockNumbers: string[] = [];
  for (let b = milestone.startBlock; b <= milestone.endBlock; b++) {
    blockNumbers.push(b.toString());
  }

  // Step 1: Get block timestamps using index-friendly ANY() query
  // This uses the primary key index on block_number efficiently
  const blocks = await query<{ block_number: string; timestamp: Date }>(
    `SELECT block_number, timestamp FROM blocks WHERE block_number = ANY($1::bigint[])`,
    [blockNumbers]
  );

  // Step 2: Build timestamp map for fast lookup
  const timestampMap = new Map<string, Date>();
  for (const block of blocks) {
    timestampMap.set(block.block_number, block.timestamp);
  }

  // Step 3: Build arrays for batch insert
  const milestoneTimestamp = milestone.timestamp;
  const milestoneIdStr = milestone.milestoneId.toString();
  const now = new Date();

  const milestoneIds: string[] = [];
  const finalizedAtArray: Date[] = [];
  const timeToFinalityArray: (number | null)[] = [];
  const createdAtArray: Date[] = [];

  for (const bn of blockNumbers) {
    const blockTs = timestampMap.get(bn);
    const timeToFinality = blockTs
      ? (milestoneTimestamp.getTime() - blockTs.getTime()) / 1000
      : null;

    milestoneIds.push(milestoneIdStr);
    finalizedAtArray.push(milestoneTimestamp);
    timeToFinalityArray.push(timeToFinality);
    createdAtArray.push(now);
  }

  // Step 4: Batch insert without JOIN (uses unnest but no table scan)
  const result = await query<{ count: string }>(
    `WITH inserted AS (
      INSERT INTO block_finality (block_number, milestone_id, finalized_at, time_to_finality_sec, created_at)
      SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::timestamptz[], $4::real[], $5::timestamptz[])
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
    [blockNumbers, milestoneIds, finalizedAtArray, timeToFinalityArray, createdAtArray]
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


