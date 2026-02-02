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
       min_value = LEAST(COALESCE(table_stats.min_value, EXCLUDED.min_value), EXCLUDED.min_value),
       max_value = GREATEST(COALESCE(table_stats.max_value, EXCLUDED.max_value), EXCLUDED.max_value),
       total_count = table_stats.total_count + $5,
       updated_at = NOW()`,
    [tableName, minValue.toString(), maxValue.toString(), incrementCount, incrementCount]
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
    minValue: row.min_value ? BigInt(row.min_value) : null,
    maxValue: row.max_value ? BigInt(row.max_value) : null,
    totalCount: BigInt(row.total_count),
    finalizedCount: row.finalized_count ? BigInt(row.finalized_count) : null,
    minFinalized: row.min_finalized ? BigInt(row.min_finalized) : null,
    maxFinalized: row.max_finalized ? BigInt(row.max_finalized) : null,
    updatedAt: row.updated_at,
  };
}

