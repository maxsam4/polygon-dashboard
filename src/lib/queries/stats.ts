import { query, queryOne } from '../db';
import type { TableStats, TableStatsRow } from '../types';

/**
 * Update table statistics incrementally.
 * Called by workers after inserting new data to maintain cached stats.
 *
 * @param tableName - Name of the table ('blocks' or 'milestones')
 * @param minValue - Minimum value being inserted
 * @param maxValue - Maximum value being inserted
 * @param incrementCount - Number of rows being inserted (default: 1)
 */
export async function updateTableStats(
  tableName: 'blocks' | 'milestones',
  minValue: bigint,
  maxValue: bigint,
  incrementCount = 1
): Promise<void> {
  await query(
    `INSERT INTO table_stats (table_name, min_value, max_value, total_count, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (table_name) DO UPDATE SET
       min_value = LEAST(table_stats.min_value, EXCLUDED.min_value),
       max_value = GREATEST(table_stats.max_value, EXCLUDED.max_value),
       total_count = table_stats.total_count + $5,
       updated_at = NOW()`,
    [tableName, minValue.toString(), maxValue.toString(), incrementCount, incrementCount]
  );
}

/**
 * Update finality statistics for blocks.
 * Called by FinalityReconciler after updating finalized flags.
 *
 * @param finalizedCount - Total number of finalized blocks
 * @param minFinalized - Minimum finalized block number
 * @param maxFinalized - Maximum finalized block number
 */
export async function updateFinalityStats(
  finalizedCount: bigint,
  minFinalized: bigint | null,
  maxFinalized: bigint | null
): Promise<void> {
  await query(
    `UPDATE table_stats
     SET finalized_count = $1,
         min_finalized = $2,
         max_finalized = $3,
         updated_at = NOW()
     WHERE table_name = 'blocks'`,
    [
      finalizedCount.toString(),
      minFinalized ? minFinalized.toString() : null,
      maxFinalized ? maxFinalized.toString() : null,
    ]
  );
}

/**
 * Get cached table statistics.
 * This is a fast O(1) lookup that avoids scanning compressed chunks.
 *
 * @param tableName - Name of the table ('blocks' or 'milestones')
 * @returns Table statistics or null if not initialized
 */
export async function getTableStats(
  tableName: 'blocks' | 'milestones'
): Promise<TableStats | null> {
  const row = await queryOne<TableStatsRow>(
    `SELECT * FROM table_stats WHERE table_name = $1`,
    [tableName]
  );

  if (!row) {
    return null;
  }

  return {
    minValue: BigInt(row.min_value),
    maxValue: BigInt(row.max_value),
    totalCount: BigInt(row.total_count),
    finalizedCount: row.finalized_count ? BigInt(row.finalized_count) : null,
    minFinalized: row.min_finalized ? BigInt(row.min_finalized) : null,
    maxFinalized: row.max_finalized ? BigInt(row.max_finalized) : null,
    updatedAt: row.updated_at,
  };
}

/**
 * Get pending unfinalized block count (only recent blocks that can still be finalized).
 * Excludes blocks in compressed chunks (>10 days old) that can't be efficiently updated.
 */
export async function getPendingUnfinalizedCount(): Promise<number> {
  const compressionThreshold = new Date();
  compressionThreshold.setDate(compressionThreshold.getDate() - 10); // 10 days ago

  const result = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text as count
     FROM blocks
     WHERE finalized = false
       AND timestamp >= $1`,
    [compressionThreshold]
  );

  return parseInt(result?.count ?? '0', 10);
}

/**
 * Refresh finality statistics from actual data.
 * This queries finalized blocks and updates the cached stats.
 * More efficient than refreshTableStats because it only updates finality fields.
 */
export async function refreshFinalityStats(): Promise<void> {
  const result = await queryOne<{
    finalized_count: string;
    min_finalized: string | null;
    max_finalized: string | null;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE finalized = true)::text as finalized_count,
       MIN(block_number) FILTER (WHERE finalized = true)::text as min_finalized,
       MAX(block_number) FILTER (WHERE finalized = true)::text as max_finalized
     FROM blocks`
  );

  if (result) {
    await updateFinalityStats(
      BigInt(result.finalized_count),
      result.min_finalized ? BigInt(result.min_finalized) : null,
      result.max_finalized ? BigInt(result.max_finalized) : null
    );
  }
}

/**
 * Refresh table statistics from actual data.
 * Use this sparingly - it's expensive and defeats the purpose of caching.
 * Mainly for verification or recovery scenarios.
 *
 * @param tableName - Name of the table to refresh
 */
export async function refreshTableStats(tableName: 'blocks' | 'milestones'): Promise<void> {
  if (tableName === 'blocks') {
    await query(
      `INSERT INTO table_stats (table_name, min_value, max_value, total_count, finalized_count, min_finalized, max_finalized, updated_at)
       SELECT
         'blocks',
         COALESCE(MIN(block_number), 0)::BIGINT,
         COALESCE(MAX(block_number), 0)::BIGINT,
         COUNT(*)::BIGINT,
         COUNT(*) FILTER (WHERE finalized = true)::BIGINT,
         MIN(block_number) FILTER (WHERE finalized = true)::BIGINT,
         MAX(block_number) FILTER (WHERE finalized = true)::BIGINT,
         NOW()
       FROM blocks
       ON CONFLICT (table_name) DO UPDATE SET
         min_value = EXCLUDED.min_value,
         max_value = EXCLUDED.max_value,
         total_count = EXCLUDED.total_count,
         finalized_count = EXCLUDED.finalized_count,
         min_finalized = EXCLUDED.min_finalized,
         max_finalized = EXCLUDED.max_finalized,
         updated_at = EXCLUDED.updated_at`
    );
  } else {
    await query(
      `INSERT INTO table_stats (table_name, min_value, max_value, total_count, updated_at)
       SELECT
         'milestones',
         COALESCE(MIN(sequence_id), 0)::BIGINT,
         COALESCE(MAX(sequence_id), 0)::BIGINT,
         COUNT(*)::BIGINT,
         NOW()
       FROM milestones
       ON CONFLICT (table_name) DO UPDATE SET
         min_value = EXCLUDED.min_value,
         max_value = EXCLUDED.max_value,
         total_count = EXCLUDED.total_count,
         updated_at = EXCLUDED.updated_at`
    );
  }
}
