import { query, queryOne } from '../db';
import { Block, BlockRow } from '../types';
import { getTableStats } from './stats';
import { BLOCK_TIME_SUSPECT_THRESHOLD_SEC } from '../constants';

function rowToBlock(row: BlockRow): Block {
  return {
    blockNumber: BigInt(row.block_number),
    timestamp: row.timestamp,
    blockHash: row.block_hash,
    parentHash: row.parent_hash,
    gasUsed: BigInt(row.gas_used),
    gasLimit: BigInt(row.gas_limit),
    baseFeeGwei: row.base_fee_gwei,
    minPriorityFeeGwei: row.min_priority_fee_gwei,
    maxPriorityFeeGwei: row.max_priority_fee_gwei,
    avgPriorityFeeGwei: row.avg_priority_fee_gwei,
    medianPriorityFeeGwei: row.median_priority_fee_gwei,
    totalBaseFeeGwei: row.total_base_fee_gwei,
    totalPriorityFeeGwei: row.total_priority_fee_gwei,
    txCount: row.tx_count,
    blockTimeSec: row.block_time_sec,
    mgasPerSec: row.mgas_per_sec,
    tps: row.tps,
    finalized: row.finalized,
    finalizedAt: row.finalized_at,
    milestoneId: row.milestone_id ? BigInt(row.milestone_id) : null,
    timeToFinalitySec: row.time_to_finality_sec,
  };
}

export async function getLatestBlocks(limit = 20): Promise<Block[]> {
  // Query only the last hour to avoid expensive parallel sequential scans
  // on compressed chunks. Latest blocks are always within the last minute.
  // This restriction ensures we only touch the most recent uncompressed chunk.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const rows = await query<BlockRow>(
    `SELECT * FROM blocks
     WHERE timestamp >= $1
     ORDER BY block_number DESC
     LIMIT $2`,
    [oneHourAgo, limit]
  );
  return rows.map(rowToBlock);
}

export async function getBlockByNumber(blockNumber: bigint): Promise<Block | null> {
  // Polygon produces blocks every ~2s. Estimate timestamp from block number
  // to enable TimescaleDB chunk pruning and avoid full table scans on 80M+ rows.
  // Polygon genesis: June 1, 2020. Use a generous ±1 day window around estimate.
  const POLYGON_GENESIS_UNIX = 1590969600; // 2020-06-01T00:00:00Z
  const AVG_BLOCK_TIME_SEC = 2;
  const estimatedTimestamp = POLYGON_GENESIS_UNIX + Number(blockNumber) * AVG_BLOCK_TIME_SEC;
  const windowSec = 86400; // ±1 day to account for block time variance over millions of blocks
  const tsLow = new Date((estimatedTimestamp - windowSec) * 1000);
  const tsHigh = new Date((estimatedTimestamp + windowSec) * 1000);

  const row = await queryOne<BlockRow>(
    `SELECT * FROM blocks WHERE block_number = $1 AND timestamp BETWEEN $2 AND $3`,
    [blockNumber.toString(), tsLow, tsHigh]
  );
  if (row) return rowToBlock(row);

  // Fallback: if estimation missed (e.g., very old block with different block times),
  // try without timestamp filter. This is slower but ensures correctness.
  const fallbackRow = await queryOne<BlockRow>(
    `SELECT * FROM blocks WHERE block_number = $1`,
    [blockNumber.toString()]
  );
  return fallbackRow ? rowToBlock(fallbackRow) : null;
}

export async function getBlocksPaginated(
  page: number,
  limit: number,
  fromBlock?: bigint,
  toBlock?: bigint
): Promise<{ blocks: Block[]; total: number }> {
  const offset = (page - 1) * limit;
  const stats = await getTableStats('blocks');
  let total: number;

  // Use cached stats for total count to avoid expensive COUNT(*) on compressed chunks
  if (fromBlock === undefined && toBlock === undefined) {
    total = stats ? Number(stats.totalCount) : 0;
  } else {
    // With block range filter: calculate from range (O(1))
    if (stats && stats.minValue !== null && stats.maxValue !== null) {
      const effectiveFrom = fromBlock ?? stats.minValue;
      const effectiveTo = toBlock ?? stats.maxValue;
      total = Number(effectiveTo - effectiveFrom + 1n);
    } else {
      total = 0;
    }
  }

  // For unfiltered queries, use block_number range instead of OFFSET
  // This avoids scanning compressed chunks by targeting specific block ranges
  if (fromBlock === undefined && toBlock === undefined && stats && stats.maxValue !== null) {
    const maxBlock = stats.maxValue;
    // Calculate block range for this page (blocks are sorted DESC)
    const rangeEnd = maxBlock - BigInt(offset);
    const rangeStart = rangeEnd - BigInt(limit) + 1n;

    const dataQuery = `
      SELECT * FROM blocks
      WHERE block_number <= $1 AND block_number >= $2
      ORDER BY block_number DESC
      LIMIT $3
    `;
    const rows = await query<BlockRow>(dataQuery, [
      rangeEnd.toString(),
      rangeStart.toString(),
      limit,
    ]);

    return {
      blocks: rows.map(rowToBlock),
      total,
    };
  }

  // Filtered queries: use traditional WHERE clause with OFFSET
  let whereClause = '';
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (fromBlock !== undefined) {
    whereClause += ` AND block_number >= $${paramIndex++}`;
    params.push(fromBlock.toString());
  }
  if (toBlock !== undefined) {
    whereClause += ` AND block_number <= $${paramIndex++}`;
    params.push(toBlock.toString());
  }

  const dataQuery = `
    SELECT * FROM blocks
    WHERE 1=1 ${whereClause}
    ORDER BY block_number DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;
  const rows = await query<BlockRow>(dataQuery, [...params, limit, offset]);

  return {
    blocks: rows.map(rowToBlock),
    total,
  };
}

export async function getLowestBlockNumber(): Promise<bigint | null> {
  const stats = await getTableStats('blocks');
  return stats?.minValue ?? null;
}

export async function getHighestBlockNumber(): Promise<bigint | null> {
  const stats = await getTableStats('blocks');
  return stats?.maxValue ?? null;
}

/**
 * Get highest block number directly from DB (not cached stats).
 * Used for indexer initialization where correctness is critical.
 *
 * Queries only the last 7 days first (fast, uses chunk pruning), then
 * falls back to unfiltered scan if no recent data exists.
 */
export async function getHighestBlockNumberFromDb(): Promise<bigint | null> {
  // Try recent data first (fast - avoids scanning compressed chunks)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = await query<{ max: string | null }>(
    'SELECT MAX(block_number) as max FROM blocks WHERE timestamp >= $1',
    [sevenDaysAgo]
  );
  const recentRows = recent as unknown as Array<{ max: string | null }>;
  if (recentRows[0]?.max) return BigInt(recentRows[0].max);

  // Fallback: full scan (only hits if DB has no data in last 7 days)
  const result = await query<{ max: string | null }>(
    'SELECT MAX(block_number) as max FROM blocks'
  );
  const rows = result as unknown as Array<{ max: string | null }>;
  return rows[0]?.max ? BigInt(rows[0].max) : null;
}

/**
 * Insert a single block with ON CONFLICT DO UPDATE semantics.
 * Used by the live BlockIndexer where blocks may be re-indexed due to reorgs.
 * The UPDATE preserves receipt-based metrics (avg/total priority fees) if already populated,
 * and conditionally updates block_time/mgas/tps based on data quality.
 *
 * Note: insertBlocksBatch() uses ON CONFLICT DO NOTHING because it's used by the
 * backfiller where blocks are immutable and skipping duplicates is correct behavior.
 */
export async function insertBlock(block: Omit<Block, 'createdAt' | 'updatedAt'>): Promise<void> {
  await query(
    `INSERT INTO blocks (
      timestamp, block_number, block_hash, parent_hash,
      gas_used, gas_limit, base_fee_gwei,
      min_priority_fee_gwei, max_priority_fee_gwei, avg_priority_fee_gwei, median_priority_fee_gwei,
      total_base_fee_gwei, total_priority_fee_gwei,
      tx_count, block_time_sec, mgas_per_sec, tps,
      finalized, finalized_at, milestone_id, time_to_finality_sec
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    ON CONFLICT (timestamp, block_number) DO UPDATE SET
      block_hash = EXCLUDED.block_hash,
      parent_hash = EXCLUDED.parent_hash,
      gas_used = EXCLUDED.gas_used,
      gas_limit = EXCLUDED.gas_limit,
      base_fee_gwei = EXCLUDED.base_fee_gwei,
      min_priority_fee_gwei = EXCLUDED.min_priority_fee_gwei,
      max_priority_fee_gwei = EXCLUDED.max_priority_fee_gwei,
      avg_priority_fee_gwei = COALESCE(EXCLUDED.avg_priority_fee_gwei, blocks.avg_priority_fee_gwei),
      median_priority_fee_gwei = EXCLUDED.median_priority_fee_gwei,
      total_base_fee_gwei = EXCLUDED.total_base_fee_gwei,
      total_priority_fee_gwei = COALESCE(EXCLUDED.total_priority_fee_gwei, blocks.total_priority_fee_gwei),
      tx_count = EXCLUDED.tx_count,
      -- Only update block_time if new value is not null, or existing value is null/suspect.
      -- Polygon target block time is 2s; values > BLOCK_TIME_SUSPECT_THRESHOLD_SEC (${BLOCK_TIME_SUSPECT_THRESHOLD_SEC}s)
      -- are likely stale (e.g., from a missed previous block) and should be overwritten.
      block_time_sec = CASE
        WHEN EXCLUDED.block_time_sec IS NOT NULL THEN EXCLUDED.block_time_sec
        WHEN blocks.block_time_sec IS NULL OR blocks.block_time_sec > ${BLOCK_TIME_SUSPECT_THRESHOLD_SEC} THEN EXCLUDED.block_time_sec
        ELSE blocks.block_time_sec
      END,
      mgas_per_sec = CASE
        WHEN EXCLUDED.block_time_sec IS NOT NULL THEN EXCLUDED.mgas_per_sec
        WHEN blocks.block_time_sec IS NULL OR blocks.block_time_sec > ${BLOCK_TIME_SUSPECT_THRESHOLD_SEC} THEN EXCLUDED.mgas_per_sec
        ELSE blocks.mgas_per_sec
      END,
      tps = CASE
        WHEN EXCLUDED.block_time_sec IS NOT NULL THEN EXCLUDED.tps
        WHEN blocks.block_time_sec IS NULL OR blocks.block_time_sec > ${BLOCK_TIME_SUSPECT_THRESHOLD_SEC} THEN EXCLUDED.tps
        ELSE blocks.tps
      END,
      updated_at = NOW()
    WHERE blocks.finalized = FALSE`,
    [
      block.timestamp,
      block.blockNumber.toString(),
      block.blockHash,
      block.parentHash,
      block.gasUsed.toString(),
      block.gasLimit.toString(),
      block.baseFeeGwei,
      block.minPriorityFeeGwei,
      block.maxPriorityFeeGwei,
      block.avgPriorityFeeGwei,
      block.medianPriorityFeeGwei,
      block.totalBaseFeeGwei,
      block.totalPriorityFeeGwei,
      block.txCount,
      block.blockTimeSec,
      block.mgasPerSec,
      block.tps,
      block.finalized,
      block.finalizedAt,
      block.milestoneId?.toString() ?? null,
      block.timeToFinalitySec,
    ]
  );
}

/**
 * Batch insert blocks with ON CONFLICT DO NOTHING semantics.
 * Used by the BlockBackfiller for historical data where blocks are immutable.
 * Skipping duplicates is correct here - if a block already exists, the live
 * indexer's insertBlock() has already written the authoritative version.
 * Finality is reconciled in a separate UPDATE after the insert.
 */
export async function insertBlocksBatch(blocks: Omit<Block, 'createdAt' | 'updatedAt'>[]): Promise<void> {
  if (blocks.length === 0) return;

  // Simple batch insert - finality is reconciled after insert from block_finality table
  const values: string[] = [];
  const params: unknown[] = [];
  const PARAMS_PER_BLOCK = 21;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const offset = i * PARAMS_PER_BLOCK;
    const placeholders = Array.from(
      { length: PARAMS_PER_BLOCK },
      (_, j) => `$${offset + j + 1}`
    ).join(', ');
    values.push(`(${placeholders})`);

    params.push(
      block.timestamp,
      block.blockNumber.toString(),
      block.blockHash,
      block.parentHash,
      block.gasUsed.toString(),
      block.gasLimit.toString(),
      block.baseFeeGwei,
      block.minPriorityFeeGwei,
      block.maxPriorityFeeGwei,
      block.avgPriorityFeeGwei,
      block.medianPriorityFeeGwei,
      block.totalBaseFeeGwei,
      block.totalPriorityFeeGwei,
      block.txCount,
      block.blockTimeSec,
      block.mgasPerSec,
      block.tps,
      block.finalized,
      block.finalizedAt,
      block.milestoneId?.toString() ?? null,
      block.timeToFinalitySec
    );
  }

  await query(
    `INSERT INTO blocks (
      timestamp, block_number, block_hash, parent_hash,
      gas_used, gas_limit, base_fee_gwei,
      min_priority_fee_gwei, max_priority_fee_gwei, avg_priority_fee_gwei, median_priority_fee_gwei,
      total_base_fee_gwei, total_priority_fee_gwei,
      tx_count, block_time_sec, mgas_per_sec, tps,
      finalized, finalized_at, milestone_id, time_to_finality_sec
    ) VALUES ${values.join(', ')}
    ON CONFLICT (timestamp, block_number) DO NOTHING`,
    params
  );

  // Reconcile finality from block_finality table for newly inserted blocks
  // This handles the case where milestones arrived before blocks were indexed
  const blockNumbers = blocks.map(b => b.blockNumber.toString());

  // Get min timestamp from blocks for TimescaleDB chunk pruning
  // Without this, TimescaleDB scans ALL chunks (including compressed 7-day chunks)
  // to find matching block_numbers, triggering decompression limit errors
  const minTimestamp = blocks.reduce(
    (min, b) => (b.timestamp < min ? b.timestamp : min),
    blocks[0].timestamp
  );

  await query(
    `UPDATE blocks b
     SET
       finalized = TRUE,
       finalized_at = bf.finalized_at,
       milestone_id = bf.milestone_id,
       time_to_finality_sec = EXTRACT(EPOCH FROM (bf.finalized_at - b.timestamp)),
       updated_at = NOW()
     FROM block_finality bf
     WHERE b.block_number = bf.block_number
       AND b.block_number = ANY($1::bigint[])
       AND b.timestamp >= $2
       AND b.finalized = FALSE`,
    [blockNumbers, minTimestamp]
  );
}


