import { query, queryOne } from '../db';
import { Milestone } from '../types';

interface BlockFinalityRow {
  block_number: string;
  milestone_id: string;
  finalized_at: Date;
  time_to_finality_sec: number | null;
  created_at: Date;
}

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

  return inserted;
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

/**
 * Get finality data for a block.
 */
export async function getBlockFinality(blockNumber: bigint): Promise<{
  blockNumber: bigint;
  milestoneId: bigint;
  finalizedAt: Date;
  timeToFinalitySec: number | null;
} | null> {
  const row = await queryOne<BlockFinalityRow>(
    `SELECT * FROM block_finality WHERE block_number = $1`,
    [blockNumber.toString()]
  );

  if (!row) return null;

  return {
    blockNumber: BigInt(row.block_number),
    milestoneId: BigInt(row.milestone_id),
    finalizedAt: row.finalized_at,
    timeToFinalitySec: row.time_to_finality_sec,
  };
}

/**
 * Get finality stats for monitoring.
 */
export async function getFinalityStats(): Promise<{
  totalRecords: number;
  withTimingData: number;
  withoutTimingData: number;
  avgTimeToFinality: number | null;
  minBlock: bigint | null;
  maxBlock: bigint | null;
}> {
  const result = await queryOne<{
    total: string;
    with_timing: string;
    without_timing: string;
    avg_ttf: number | null;
    min_block: string | null;
    max_block: string | null;
  }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE time_to_finality_sec IS NOT NULL) as with_timing,
       COUNT(*) FILTER (WHERE time_to_finality_sec IS NULL) as without_timing,
       AVG(time_to_finality_sec) as avg_ttf,
       MIN(block_number)::text as min_block,
       MAX(block_number)::text as max_block
     FROM block_finality`
  );

  if (!result) {
    return {
      totalRecords: 0,
      withTimingData: 0,
      withoutTimingData: 0,
      avgTimeToFinality: null,
      minBlock: null,
      maxBlock: null,
    };
  }

  return {
    totalRecords: parseInt(result.total, 10),
    withTimingData: parseInt(result.with_timing, 10),
    withoutTimingData: parseInt(result.without_timing, 10),
    avgTimeToFinality: result.avg_ttf,
    minBlock: result.min_block ? BigInt(result.min_block) : null,
    maxBlock: result.max_block ? BigInt(result.max_block) : null,
  };
}

/**
 * Backfill time_to_finality_sec for block_finality records that have block data.
 * Used when blocks are indexed after finality data was written.
 */
export async function backfillFinalityTiming(limit: number = 1000): Promise<number> {
  const result = await query<{ count: string }>(
    `WITH to_update AS (
       SELECT bf.block_number
       FROM block_finality bf
       JOIN blocks b ON b.block_number = bf.block_number
       WHERE bf.time_to_finality_sec IS NULL
       LIMIT $1
     ),
     updated AS (
       UPDATE block_finality bf
       SET time_to_finality_sec = EXTRACT(EPOCH FROM (bf.finalized_at - b.timestamp))
       FROM blocks b, to_update
       WHERE bf.block_number = to_update.block_number
         AND b.block_number = bf.block_number
       RETURNING 1
     )
     SELECT COUNT(*) as count FROM updated`,
    [limit]
  );

  return parseInt(result[0]?.count ?? '0', 10);
}
