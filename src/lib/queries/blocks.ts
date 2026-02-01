import { query, queryOne, getPool } from '../db';
import { Block, BlockRow } from '../types';
import { getTableStats } from './stats';

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
  const row = await queryOne<BlockRow>(
    `SELECT * FROM blocks WHERE block_number = $1`,
    [blockNumber.toString()]
  );
  return row ? rowToBlock(row) : null;
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
      -- Only update block_time if new value is not null, or existing value is null/wrong (>3s)
      block_time_sec = CASE
        WHEN EXCLUDED.block_time_sec IS NOT NULL THEN EXCLUDED.block_time_sec
        WHEN blocks.block_time_sec IS NULL OR blocks.block_time_sec > 3 THEN EXCLUDED.block_time_sec
        ELSE blocks.block_time_sec
      END,
      mgas_per_sec = CASE
        WHEN EXCLUDED.block_time_sec IS NOT NULL THEN EXCLUDED.mgas_per_sec
        WHEN blocks.block_time_sec IS NULL OR blocks.block_time_sec > 3 THEN EXCLUDED.mgas_per_sec
        ELSE blocks.mgas_per_sec
      END,
      tps = CASE
        WHEN EXCLUDED.block_time_sec IS NOT NULL THEN EXCLUDED.tps
        WHEN blocks.block_time_sec IS NULL OR blocks.block_time_sec > 3 THEN EXCLUDED.tps
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
       AND b.finalized = FALSE`,
    [blockNumbers]
  );
}

/**
 * Update priority fee metrics for a single block after receipts are fetched.
 * Used by LivePoller to fill in pending metrics asynchronously.
 *
 * Requires timestamp for efficient TimescaleDB chunk pruning - without it,
 * the query would scan all chunks including compressed ones.
 */
export async function updateBlockPriorityFees(
  blockNumber: bigint,
  timestamp: Date,
  minPriorityFeeGwei: number,
  maxPriorityFeeGwei: number,
  avgPriorityFeeGwei: number,
  medianPriorityFeeGwei: number,
  totalPriorityFeeGwei: number
): Promise<void> {
  await query(
    `UPDATE blocks
     SET min_priority_fee_gwei = $1,
         max_priority_fee_gwei = $2,
         avg_priority_fee_gwei = $3,
         median_priority_fee_gwei = $4,
         total_priority_fee_gwei = $5,
         updated_at = NOW()
     WHERE block_number = $6 AND timestamp = $7`,
    [minPriorityFeeGwei, maxPriorityFeeGwei, avgPriorityFeeGwei, medianPriorityFeeGwei, totalPriorityFeeGwei, blockNumber.toString(), timestamp]
  );
}

export async function updateBlockFinality(
  blockNumber: bigint,
  milestoneId: bigint,
  finalizedAt: Date
): Promise<void> {
  const timeToFinality = await queryOne<{ block_timestamp: Date }>(
    `SELECT timestamp as block_timestamp FROM blocks WHERE block_number = $1`,
    [blockNumber.toString()]
  );

  const timeToFinalitySec = timeToFinality
    ? (finalizedAt.getTime() - timeToFinality.block_timestamp.getTime()) / 1000
    : null;

  await query(
    `UPDATE blocks SET
      finalized = TRUE,
      finalized_at = $1,
      milestone_id = $2,
      time_to_finality_sec = $3,
      updated_at = NOW()
    WHERE block_number = $4 AND finalized = FALSE`,
    [finalizedAt, milestoneId.toString(), timeToFinalitySec, blockNumber.toString()]
  );
}

export async function resetInvalidFinalityData(maxValidFinalitySec = 300): Promise<number> {
  // Reset finality data for blocks with unreasonably high finality times
  // This allows the milestone backfiller to recalculate the correct values
  const result = await query(
    `UPDATE blocks SET
      finalized = FALSE,
      finalized_at = NULL,
      milestone_id = NULL,
      time_to_finality_sec = NULL,
      updated_at = NOW()
    WHERE time_to_finality_sec > $1`,
    [maxValidFinalitySec]
  );
  return (result as unknown as { rowCount: number }).rowCount ?? 0;
}

export async function updateBlocksPriorityFeeBatch(
  updates: Array<{ blockNumber: bigint; totalPriorityFeeGwei: number }>
): Promise<number> {
  if (updates.length === 0) return 0;

  // Process in chunks to avoid TimescaleDB decompression limits
  // With timestamp filter, we can use larger chunks for uncompressed data
  const CHUNK_SIZE = 50;
  let totalUpdated = 0;

  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE);
    const blockNumbers = chunk.map(u => u.blockNumber.toString());
    const fees = chunk.map(u => u.totalPriorityFeeGwei);

    try {
      // Batch update using UNNEST for efficiency
      // Assumes chunks are decompressed (run migration first)
      const result = await queryOne<{ count: string }>(
        `WITH updated AS (
           UPDATE blocks b
           SET total_priority_fee_gwei = u.fee, updated_at = NOW()
           FROM UNNEST($1::bigint[], $2::double precision[]) AS u(block_num, fee)
           WHERE b.block_number = u.block_num
           RETURNING 1
         )
         SELECT COUNT(*) as count FROM updated`,
        [blockNumbers, fees]
      );

      totalUpdated += parseInt(result?.count ?? '0', 10);
    } catch (error) {
      // If batch update fails completely, fall back to individual updates
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`[updateBlocksPriorityFeeBatch] Batch update failed: ${errorMessage}`);

      for (const update of chunk) {
        try {
          await query(
            `UPDATE blocks SET total_priority_fee_gwei = $1, updated_at = NOW() WHERE block_number = $2`,
            [update.totalPriorityFeeGwei, update.blockNumber.toString()]
          );
          totalUpdated++;
        } catch (individualError) {
          console.warn(`[updateBlocksPriorityFeeBatch] Individual update failed for block ${update.blockNumber}: ${individualError instanceof Error ? individualError.message : String(individualError)}`);
        }
      }
    }
  }

  return totalUpdated;
}

export async function updateBlocksFinalityInRange(
  startBlock: bigint,
  endBlock: bigint,
  milestoneId: bigint,
  finalizedAt: Date
): Promise<number> {
  // Only update blocks within the milestone's actual range (startBlock to endBlock)
  // Using the milestone timestamp is only accurate for blocks in this range
  const result = await query<{ block_number: string; timestamp: Date }>(
    `SELECT block_number, timestamp FROM blocks
     WHERE block_number >= $1 AND block_number <= $2 AND finalized = FALSE`,
    [startBlock.toString(), endBlock.toString()]
  );

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const row of result) {
      const timeToFinalitySec = (finalizedAt.getTime() - row.timestamp.getTime()) / 1000;
      await client.query(
        `UPDATE blocks SET
          finalized = TRUE,
          finalized_at = $1,
          milestone_id = $2,
          time_to_finality_sec = $3,
          updated_at = NOW()
        WHERE block_number = $4`,
        [finalizedAt, milestoneId.toString(), timeToFinalitySec, row.block_number]
      );
    }

    await client.query('COMMIT');
    return result.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Recompress old chunks after priority fee fix completes.
 * Only compresses chunks older than 7 days to match the compression policy.
 */
export async function recompressOldChunks(): Promise<number> {
  const result = await query<{ chunk_schema: string; chunk_name: string }>(
    `SELECT chunk_schema, chunk_name
     FROM timescaledb_information.chunks
     WHERE hypertable_name = 'blocks'
       AND is_compressed = false
       AND range_end < NOW() - INTERVAL '35 days'
     ORDER BY range_start`
  );

  let compressedCount = 0;
  for (const chunk of result) {
    try {
      await query(
        `SELECT compress_chunk($1::regclass)`,
        [`${chunk.chunk_schema}.${chunk.chunk_name}`]
      );
      compressedCount++;
      console.log(`[recompressOldChunks] Compressed ${chunk.chunk_schema}.${chunk.chunk_name}`);
    } catch (error) {
      console.error(`[recompressOldChunks] Failed to compress ${chunk.chunk_schema}.${chunk.chunk_name}:`, error);
    }
  }

  return compressedCount;
}
