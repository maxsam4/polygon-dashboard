import { queryOne } from '../db';
import { getTableStats } from './stats';
import { getIndexerState } from '../indexers/indexerState';

/**
 * Get block aggregate statistics using cached table_stats.
 * This replaces expensive MIN/MAX/COUNT queries with fast O(1) lookups.
 */
export async function getBlockAggregates() {
  const stats = await getTableStats('blocks');

  if (!stats || stats.minValue === null || stats.maxValue === null) {
    // Fallback to empty stats if table not initialized yet or no data
    return {
      minBlock: null,
      maxBlock: null,
      totalCount: stats ? Number(stats.totalCount) : 0,
      finalizedCount: stats?.finalizedCount ? Number(stats.finalizedCount) : 0,
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

  if (!stats || stats.minValue === null || stats.maxValue === null) {
    // Fallback to empty stats if table not initialized yet or no data
    return {
      minSeq: null,
      maxSeq: null,
      totalCount: stats ? Number(stats.totalCount) : 0,
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
 * Get latest block using index scan.
 * Uses timestamp filter to avoid scanning compressed chunks.
 */
export async function getLatestBlock() {
  // Filter to last hour to avoid parallel scans on compressed chunks
  // Latest block should always be within seconds of now
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  return queryOne<{ block_number: string; timestamp: Date }>(`
    SELECT block_number::text, timestamp
    FROM blocks
    WHERE timestamp >= $1
    ORDER BY block_number DESC
    LIMIT 1
  `, [oneHourAgo]);
}

/**
 * Get latest milestone using index scan.
 * Uses subquery to ensure ORDER BY uses the index before casting to text.
 */
export async function getLatestMilestone() {
  return queryOne<{ sequence_id: string; end_block: string; timestamp: Date }>(`
    SELECT sequence_id::text, end_block::text, timestamp
    FROM (
      SELECT sequence_id, end_block, timestamp
      FROM milestones
      ORDER BY sequence_id DESC
      LIMIT 1
    ) m
  `);
}

/**
 * Get historical priority fee backfiller progress.
 * The backfiller works backward from max block to min block.
 */
export async function getPriorityFeeBackfillerProgress() {
  const state = await getIndexerState('historical_priority_fee_backfiller');
  const blockStats = await getTableStats('blocks');

  if (!state || !blockStats || blockStats.minValue === null || blockStats.maxValue === null) {
    return null;
  }

  const cursor = state.blockNumber;
  const minBlock = blockStats.minValue;
  const maxBlock = blockStats.maxValue;

  // Backfiller works backward: starts at maxBlock, ends at minBlock
  // cursor represents the current position (next block to process)
  // When cursor <= minBlock, backfill is complete
  const totalBlocks = maxBlock - minBlock;
  const processedBlocks = maxBlock - cursor;

  return {
    cursor: cursor.toString(),
    minBlock: minBlock.toString(),
    maxBlock: maxBlock.toString(),
    processedBlocks: processedBlocks.toString(),
    totalBlocks: totalBlocks.toString(),
    isComplete: cursor <= minBlock,
  };
}

const RECALC_START_BLOCK = 56215884n;

/**
 * Get priority fee recalculator progress.
 * The recalculator fixes blocks with wrong non-NULL priority fees,
 * working backward from RECALC_START_BLOCK to BACKFILL_TO_BLOCK.
 */
export async function getPriorityFeeRecalculatorProgress() {
  const state = await getIndexerState('priority_fee_recalculator');

  if (!state) {
    return null;
  }

  const cursor = state.blockNumber;
  const targetBlock = BigInt(process.env.BACKFILL_TO_BLOCK || '500000');

  const totalBlocks = RECALC_START_BLOCK - targetBlock;
  const processedBlocks = RECALC_START_BLOCK - cursor;

  return {
    cursor: cursor.toString(),
    startBlock: RECALC_START_BLOCK.toString(),
    targetBlock: targetBlock.toString(),
    processedBlocks: processedBlocks.toString(),
    totalBlocks: totalBlocks.toString(),
    isComplete: cursor <= targetBlock,
  };
}
