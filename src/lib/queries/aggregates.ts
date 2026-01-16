import { queryOne } from '../db';
import { getTableStats } from './stats';

/**
 * Get block aggregate statistics using cached table_stats.
 * This replaces expensive MIN/MAX/COUNT queries with fast O(1) lookups.
 */
export async function getBlockAggregates() {
  const stats = await getTableStats('blocks');

  if (!stats) {
    // Fallback to empty stats if table not initialized yet
    return {
      minBlock: null,
      maxBlock: null,
      totalCount: 0,
      finalizedCount: 0,
      minFinalized: null,
      maxFinalized: null,
      minTimestamp: null,
      maxTimestamp: null,
    };
  }

  // Get timestamps for min/max blocks (these are fast index lookups)
  const timestampQuery = await queryOne<{
    min_timestamp: Date | null;
    max_timestamp: Date | null;
  }>(`
    SELECT
      (SELECT timestamp FROM blocks WHERE block_number = $1) as min_timestamp,
      (SELECT timestamp FROM blocks WHERE block_number = $2) as max_timestamp
  `, [stats.minValue.toString(), stats.maxValue.toString()]);

  return {
    minBlock: stats.minValue.toString(),
    maxBlock: stats.maxValue.toString(),
    totalCount: Number(stats.totalCount),
    finalizedCount: stats.finalizedCount ? Number(stats.finalizedCount) : 0,
    minFinalized: stats.minFinalized?.toString() ?? null,
    maxFinalized: stats.maxFinalized?.toString() ?? null,
    minTimestamp: timestampQuery?.min_timestamp ?? null,
    maxTimestamp: timestampQuery?.max_timestamp ?? null,
  };
}

/**
 * Get milestone aggregate statistics using cached table_stats.
 * This replaces expensive MIN/MAX/COUNT queries with fast O(1) lookups.
 */
export async function getMilestoneAggregates() {
  const stats = await getTableStats('milestones');

  if (!stats) {
    // Fallback to empty stats if table not initialized yet
    return {
      minSeq: null,
      maxSeq: null,
      totalCount: 0,
      minStartBlock: null,
      maxEndBlock: null,
      minTimestamp: null,
      maxTimestamp: null,
    };
  }

  // Get start_block, end_block, and timestamps for min/max sequence IDs (fast index lookups)
  const detailsQuery = await queryOne<{
    min_start_block: string | null;
    max_end_block: string | null;
    min_timestamp: Date | null;
    max_timestamp: Date | null;
  }>(`
    SELECT
      (SELECT start_block::text FROM milestones WHERE sequence_id = $1) as min_start_block,
      (SELECT end_block::text FROM milestones WHERE sequence_id = $2) as max_end_block,
      (SELECT timestamp FROM milestones WHERE sequence_id = $1) as min_timestamp,
      (SELECT timestamp FROM milestones WHERE sequence_id = $2) as max_timestamp
  `, [stats.minValue.toString(), stats.maxValue.toString()]);

  return {
    minSeq: stats.minValue.toString(),
    maxSeq: stats.maxValue.toString(),
    totalCount: Number(stats.totalCount),
    minStartBlock: detailsQuery?.min_start_block ?? null,
    maxEndBlock: detailsQuery?.max_end_block ?? null,
    minTimestamp: detailsQuery?.min_timestamp ?? null,
    maxTimestamp: detailsQuery?.max_timestamp ?? null,
  };
}

/**
 * Get latest block using index (fast).
 */
export async function getLatestBlock() {
  return queryOne<{ block_number: string; timestamp: Date }>(`
    SELECT block_number::text, timestamp
    FROM blocks
    ORDER BY block_number DESC
    LIMIT 1
  `);
}

/**
 * Get latest milestone by first finding MAX(sequence_id) from recent data.
 * Filters to last hour to avoid scanning old data - new milestones arrive every few seconds.
 */
export async function getLatestMilestone() {
  return queryOne<{ sequence_id: string; end_block: string; timestamp: Date }>(`
    SELECT sequence_id::text, end_block::text, timestamp
    FROM milestones
    WHERE sequence_id = (
      SELECT MAX(sequence_id)
      FROM milestones
      WHERE created_at > NOW() - INTERVAL '1 hour'
    )
  `);
}
