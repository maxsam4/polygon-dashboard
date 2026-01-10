import { query, queryOne, getPool } from '../db';
import { Block, BlockRow } from '../types';

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
  const rows = await query<BlockRow>(
    `SELECT * FROM blocks ORDER BY block_number DESC LIMIT $1`,
    [limit]
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

  const countQuery = `SELECT COUNT(*) as count FROM blocks WHERE 1=1 ${whereClause}`;
  const countResult = await queryOne<{ count: string }>(countQuery, params);
  const total = parseInt(countResult?.count ?? '0', 10);

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
  const row = await queryOne<{ min: string }>(`SELECT MIN(block_number) as min FROM blocks`);
  return row?.min ? BigInt(row.min) : null;
}

export async function getHighestBlockNumber(): Promise<bigint | null> {
  const row = await queryOne<{ max: string }>(`SELECT MAX(block_number) as max FROM blocks`);
  return row?.max ? BigInt(row.max) : null;
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
      avg_priority_fee_gwei = EXCLUDED.avg_priority_fee_gwei,
      median_priority_fee_gwei = EXCLUDED.median_priority_fee_gwei,
      total_base_fee_gwei = EXCLUDED.total_base_fee_gwei,
      total_priority_fee_gwei = EXCLUDED.total_priority_fee_gwei,
      tx_count = EXCLUDED.tx_count,
      block_time_sec = EXCLUDED.block_time_sec,
      mgas_per_sec = EXCLUDED.mgas_per_sec,
      tps = EXCLUDED.tps,
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

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const block of blocks) {
      await client.query(
        `INSERT INTO blocks (
          timestamp, block_number, block_hash, parent_hash,
          gas_used, gas_limit, base_fee_gwei,
          min_priority_fee_gwei, max_priority_fee_gwei, avg_priority_fee_gwei, median_priority_fee_gwei,
          total_base_fee_gwei, total_priority_fee_gwei,
          tx_count, block_time_sec, mgas_per_sec, tps,
          finalized, finalized_at, milestone_id, time_to_finality_sec
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        ON CONFLICT (timestamp, block_number) DO NOTHING`,
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

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
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
