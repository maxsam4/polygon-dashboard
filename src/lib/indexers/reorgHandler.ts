import { query, withTransaction } from '../db';
import { Block, BlockRow } from '../types';
import { getRpcClient } from '../rpc';
import { updateIndexerState, IndexerCursor } from './indexerState';

interface ReorgedBlockRow {
  id: number;
  block_number: string;
  timestamp: Date;
  block_hash: string;
  parent_hash: string;
  gas_used: string;
  gas_limit: string;
  base_fee_gwei: number;
  tx_count: number;
  reorged_at: Date;
  reason: string | null;
  replaced_by_hash: string | null;
}

/**
 * Move a block from the blocks table to the reorged_blocks table.
 */
export async function moveToReorgedBlocks(
  dbBlock: Block,
  replacedByHash: string,
  reason: string = 'chain reorg'
): Promise<void> {
  await withTransaction(async (client) => {
    // Insert into reorged_blocks
    await client.query(
      `INSERT INTO reorged_blocks (
        block_number, timestamp, block_hash, parent_hash,
        gas_used, gas_limit, base_fee_gwei, tx_count,
        reorged_at, reason, replaced_by_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10)`,
      [
        dbBlock.blockNumber.toString(),
        dbBlock.timestamp,
        dbBlock.blockHash,
        dbBlock.parentHash,
        dbBlock.gasUsed.toString(),
        dbBlock.gasLimit.toString(),
        dbBlock.baseFeeGwei,
        dbBlock.txCount,
        reason,
        replacedByHash,
      ]
    );

    // Delete from blocks table
    await client.query(
      `DELETE FROM blocks WHERE block_number = $1 AND timestamp = $2`,
      [dbBlock.blockNumber.toString(), dbBlock.timestamp]
    );
  });

  console.log(`[ReorgHandler] Moved block #${dbBlock.blockNumber} to reorged_blocks (replaced by ${replacedByHash.slice(0, 10)}...)`);
}

/**
 * Get a block from the database by block number.
 */
export async function getBlockByNumber(blockNumber: bigint): Promise<Block | null> {
  const row = await query<BlockRow>(
    `SELECT * FROM blocks WHERE block_number = $1`,
    [blockNumber.toString()]
  );

  if (row.length === 0) return null;

  const r = row[0];
  return {
    blockNumber: BigInt(r.block_number),
    timestamp: r.timestamp,
    blockHash: r.block_hash,
    parentHash: r.parent_hash,
    gasUsed: BigInt(r.gas_used),
    gasLimit: BigInt(r.gas_limit),
    baseFeeGwei: r.base_fee_gwei,
    minPriorityFeeGwei: r.min_priority_fee_gwei,
    maxPriorityFeeGwei: r.max_priority_fee_gwei,
    avgPriorityFeeGwei: r.avg_priority_fee_gwei,
    medianPriorityFeeGwei: r.median_priority_fee_gwei,
    totalBaseFeeGwei: r.total_base_fee_gwei,
    totalPriorityFeeGwei: r.total_priority_fee_gwei,
    txCount: r.tx_count,
    blockTimeSec: r.block_time_sec,
    mgasPerSec: r.mgas_per_sec,
    tps: r.tps,
    finalized: r.finalized,
    finalizedAt: r.finalized_at,
    milestoneId: r.milestone_id ? BigInt(r.milestone_id) : null,
    timeToFinalitySec: r.time_to_finality_sec,
  };
}

/**
 * Handle a detected reorg by walking back to find the common ancestor,
 * moving reorged blocks to the archive table, and returning the new cursor.
 *
 * @param forkBlock - The block number where the reorg was detected
 * @param serviceName - The indexer service name (for cursor updates)
 * @returns The new cursor pointing to the common ancestor
 */
export async function handleReorg(
  forkBlock: bigint,
  serviceName: string
): Promise<IndexerCursor> {
  const rpc = getRpcClient();
  let checkBlock = forkBlock;
  let commonAncestor: IndexerCursor | null = null;

  console.log(`[ReorgHandler] Starting reorg handling from block #${forkBlock}`);

  // Walk back to find common ancestor
  while (checkBlock > 0n) {
    const dbBlock = await getBlockByNumber(checkBlock);
    if (!dbBlock) {
      // Block not in DB, we've gone back too far
      // This shouldn't happen in normal operation
      console.warn(`[ReorgHandler] Block #${checkBlock} not found in DB during reorg handling`);
      checkBlock--;
      continue;
    }

    const chainBlock = await rpc.getBlock(checkBlock);

    if (dbBlock.blockHash === chainBlock.hash) {
      // Found common ancestor
      commonAncestor = {
        blockNumber: checkBlock,
        hash: chainBlock.hash,
      };
      console.log(`[ReorgHandler] Found common ancestor at block #${checkBlock}`);
      break;
    }

    // Hash mismatch - this block was reorged
    console.log(`[ReorgHandler] Block #${checkBlock} was reorged: DB=${dbBlock.blockHash.slice(0, 10)}... Chain=${chainBlock.hash.slice(0, 10)}...`);

    // Move to reorged_blocks table
    await moveToReorgedBlocks(dbBlock, chainBlock.hash);

    checkBlock--;
  }

  if (!commonAncestor) {
    // Shouldn't happen unless the entire DB is invalid
    throw new Error(`[ReorgHandler] Failed to find common ancestor for reorg starting at block #${forkBlock}`);
  }

  // Update cursor to common ancestor
  await updateIndexerState(serviceName, commonAncestor.blockNumber, commonAncestor.hash);

  return commonAncestor;
}

/**
 * Get recent reorged blocks for monitoring.
 */
export async function getRecentReorgedBlocks(
  limit: number = 100
): Promise<Array<{
  id: number;
  blockNumber: bigint;
  timestamp: Date;
  blockHash: string;
  reorgedAt: Date;
  reason: string | null;
  replacedByHash: string | null;
}>> {
  const rows = await query<ReorgedBlockRow>(
    `SELECT * FROM reorged_blocks ORDER BY reorged_at DESC LIMIT $1`,
    [limit]
  );

  return rows.map(row => ({
    id: row.id,
    blockNumber: BigInt(row.block_number),
    timestamp: row.timestamp,
    blockHash: row.block_hash,
    reorgedAt: row.reorged_at,
    reason: row.reason,
    replacedByHash: row.replaced_by_hash,
  }));
}

/**
 * Get reorg statistics.
 */
export async function getReorgStats(): Promise<{
  totalReorgs: number;
  last24Hours: number;
  last7Days: number;
}> {
  const result = await query<{
    total: string;
    last_24h: string;
    last_7d: string;
  }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE reorged_at > NOW() - INTERVAL '24 hours') as last_24h,
       COUNT(*) FILTER (WHERE reorged_at > NOW() - INTERVAL '7 days') as last_7d
     FROM reorged_blocks`
  );

  const row = result[0];
  return {
    totalReorgs: parseInt(row.total, 10),
    last24Hours: parseInt(row.last_24h, 10),
    last7Days: parseInt(row.last_7d, 10),
  };
}
