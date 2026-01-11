import { query, queryOne } from '../db';
import { Milestone, MilestoneWithStats } from '../types';

interface MilestoneRow {
  milestone_id: string;
  sequence_id: number;
  start_block: string;
  end_block: string;
  hash: string;
  proposer: string | null;
  timestamp: Date;
}

function rowToMilestone(row: MilestoneRow): Milestone {
  return {
    milestoneId: BigInt(row.milestone_id),
    sequenceId: row.sequence_id,
    startBlock: BigInt(row.start_block),
    endBlock: BigInt(row.end_block),
    hash: row.hash,
    proposer: row.proposer,
    timestamp: row.timestamp,
  };
}

export async function getLatestMilestone(): Promise<Milestone | null> {
  const row = await queryOne<MilestoneRow>(
    `SELECT * FROM milestones ORDER BY milestone_id DESC LIMIT 1`
  );
  return row ? rowToMilestone(row) : null;
}

export async function getMilestoneById(id: bigint): Promise<Milestone | null> {
  const row = await queryOne<MilestoneRow>(
    `SELECT * FROM milestones WHERE milestone_id = $1`,
    [id.toString()]
  );
  return row ? rowToMilestone(row) : null;
}

export async function getMilestoneForBlock(blockNumber: bigint): Promise<Milestone | null> {
  const row = await queryOne<MilestoneRow>(
    `SELECT * FROM milestones
     WHERE start_block <= $1 AND end_block >= $1
     ORDER BY milestone_id DESC LIMIT 1`,
    [blockNumber.toString()]
  );
  return row ? rowToMilestone(row) : null;
}

export async function insertMilestone(milestone: Milestone): Promise<void> {
  await query(
    `INSERT INTO milestones (milestone_id, sequence_id, start_block, end_block, hash, proposer, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (milestone_id) DO NOTHING`,
    [
      milestone.milestoneId.toString(),
      milestone.sequenceId,
      milestone.startBlock.toString(),
      milestone.endBlock.toString(),
      milestone.hash,
      milestone.proposer,
      milestone.timestamp,
    ]
  );
}

export async function insertMilestonesBatch(milestones: Milestone[]): Promise<void> {
  if (milestones.length === 0) return;

  // Build bulk insert with UNNEST for efficiency
  const milestoneIds = milestones.map(m => m.milestoneId.toString());
  const sequenceIds = milestones.map(m => m.sequenceId);
  const startBlocks = milestones.map(m => m.startBlock.toString());
  const endBlocks = milestones.map(m => m.endBlock.toString());
  const hashes = milestones.map(m => m.hash);
  const proposers = milestones.map(m => m.proposer);
  const timestamps = milestones.map(m => m.timestamp);

  await query(
    `INSERT INTO milestones (milestone_id, sequence_id, start_block, end_block, hash, proposer, timestamp)
     SELECT * FROM UNNEST($1::bigint[], $2::int[], $3::bigint[], $4::bigint[], $5::text[], $6::text[], $7::timestamptz[])
     ON CONFLICT (milestone_id) DO NOTHING`,
    [milestoneIds, sequenceIds, startBlocks, endBlocks, hashes, proposers, timestamps]
  );
}

export async function getLowestSequenceId(): Promise<number | null> {
  const row = await queryOne<{ min: number }>(`SELECT MIN(sequence_id) as min FROM milestones`);
  return row?.min ?? null;
}

export async function getHighestSequenceId(): Promise<number | null> {
  const row = await queryOne<{ max: number }>(`SELECT MAX(sequence_id) as max FROM milestones`);
  return row?.max ?? null;
}

export async function getLowestMilestoneId(): Promise<bigint | null> {
  const row = await queryOne<{ min: string }>(`SELECT MIN(milestone_id) as min FROM milestones`);
  return row?.min ? BigInt(row.min) : null;
}

export async function getHighestMilestoneId(): Promise<bigint | null> {
  const row = await queryOne<{ max: string }>(`SELECT MAX(milestone_id) as max FROM milestones`);
  return row?.max ? BigInt(row.max) : null;
}

// Reconcile range - process up to 1000 blocks per run
// Higher limit OK when targeting uncompressed chunks via timestamp filter
const RECONCILE_RANGE = 1000;

// Advisory lock ID for reconciliation (arbitrary unique number)
const RECONCILE_LOCK_ID = 12345678;

// Timestamp threshold - only process blocks newer than this to avoid compressed chunks
// TimescaleDB compresses chunks older than ~2 weeks, so we process recent data first
function getCompressionThreshold(): Date {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - 10); // 10 days ago
  return threshold;
}

// Try to acquire advisory lock, returns true if acquired
async function tryAcquireReconcileLock(): Promise<boolean> {
  const result = await queryOne<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock($1) as acquired`,
    [RECONCILE_LOCK_ID]
  );
  return result?.acquired ?? false;
}

// Release advisory lock
async function releaseReconcileLock(): Promise<void> {
  await query(`SELECT pg_advisory_unlock($1)`, [RECONCILE_LOCK_ID]);
}

// Single optimized reconciliation query
// Uses partial index on (finalized, block_number) WHERE finalized = FALSE
// Targets uncompressed chunks first via timestamp filter to avoid decompression limits
export async function reconcileUnfinalizedBlocks(): Promise<number> {
  // Try to acquire database-level lock to prevent concurrent reconciliation
  const acquired = await tryAcquireReconcileLock();
  if (!acquired) {
    return 0; // Another reconciliation is in progress
  }

  try {
    const threshold = getCompressionThreshold();

    // Step 1: Get a batch of unfinalized block numbers from recent (uncompressed) chunks
    const unfinalizedBlocks = await query<{ block_number: string }>(
      `SELECT block_number FROM blocks
       WHERE finalized = FALSE
         AND timestamp >= $2
       ORDER BY block_number DESC
       LIMIT $1`,
      [RECONCILE_RANGE, threshold]
    );

    if (unfinalizedBlocks.length === 0) {
      // No recent unfinalized blocks - try older blocks with smaller batch
      const olderBlocks = await query<{ block_number: string }>(
        `SELECT block_number FROM blocks
         WHERE finalized = FALSE
           AND timestamp < $2
         ORDER BY block_number DESC
         LIMIT 100`,
        [threshold]
      );

      if (olderBlocks.length === 0) {
        return 0;
      }

      const blockNumbers = olderBlocks.map(b => b.block_number);
      const result = await query<{ count: string }>(
        `WITH updated AS (
           UPDATE blocks b
           SET
             finalized = TRUE,
             finalized_at = m.timestamp,
             milestone_id = m.milestone_id,
             time_to_finality_sec = EXTRACT(EPOCH FROM (m.timestamp - b.timestamp)),
             updated_at = NOW()
           FROM milestones m
           WHERE b.block_number BETWEEN m.start_block AND m.end_block
             AND b.block_number = ANY($1::bigint[])
           RETURNING 1
         )
         SELECT COUNT(*) as count FROM updated`,
        [blockNumbers]
      );
      return parseInt(result[0]?.count ?? '0', 10);
    }

    // Step 2: Update only these specific blocks
    const blockNumbers = unfinalizedBlocks.map(b => b.block_number);
    const result = await query<{ count: string }>(
      `WITH updated AS (
         UPDATE blocks b
         SET
           finalized = TRUE,
           finalized_at = m.timestamp,
           milestone_id = m.milestone_id,
           time_to_finality_sec = EXTRACT(EPOCH FROM (m.timestamp - b.timestamp)),
           updated_at = NOW()
         FROM milestones m
         WHERE b.block_number BETWEEN m.start_block AND m.end_block
           AND b.block_number = ANY($1::bigint[])
         RETURNING 1
       )
       SELECT COUNT(*) as count FROM updated`,
      [blockNumbers]
    );
    return parseInt(result[0]?.count ?? '0', 10);
  } finally {
    await releaseReconcileLock();
  }
}

// Reconcile blocks for a specific milestone
export async function reconcileBlocksForMilestone(milestone: Milestone): Promise<number> {
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
      RETURNING 1
    )
    SELECT COUNT(*) as count FROM updated`,
    [
      milestone.timestamp,
      milestone.milestoneId.toString(),
      milestone.startBlock.toString(),
      milestone.endBlock.toString(),
    ]
  );
  return parseInt(result[0]?.count ?? '0', 10);
}

// Reconcile blocks for multiple milestones in a single query
// Uses database-level advisory lock shared with reconcileUnfinalizedBlocks
export async function reconcileBlocksForMilestones(milestones: Milestone[]): Promise<number> {
  if (milestones.length === 0) return 0;

  // Try to acquire database-level lock to prevent concurrent reconciliation
  const acquired = await tryAcquireReconcileLock();
  if (!acquired) {
    return 0; // Another reconciliation is in progress
  }

  try {
    // Find the overall block range
    const minBlock = milestones.reduce((min, m) => m.startBlock < min ? m.startBlock : min, milestones[0].startBlock);
    const maxBlock = milestones.reduce((max, m) => m.endBlock > max ? m.endBlock : max, milestones[0].endBlock);

    // Get the specific milestone IDs we care about
    const milestoneIds = milestones.map(m => m.milestoneId.toString());

    // Use a single query that joins ONLY with the specific milestones we inserted
    const result = await query<{ count: string }>(
      `WITH updated AS (
        UPDATE blocks b
        SET
          finalized = TRUE,
          finalized_at = m.timestamp,
          milestone_id = m.milestone_id,
          time_to_finality_sec = EXTRACT(EPOCH FROM (m.timestamp - b.timestamp)),
          updated_at = NOW()
        FROM milestones m
        WHERE b.block_number BETWEEN m.start_block AND m.end_block
          AND b.finalized = FALSE
          AND b.block_number BETWEEN $1 AND $2
          AND m.milestone_id = ANY($3::bigint[])
        RETURNING 1
      )
      SELECT COUNT(*) as count FROM updated`,
      [minBlock.toString(), maxBlock.toString(), milestoneIds]
    );
    return parseInt(result[0]?.count ?? '0', 10);
  } finally {
    await releaseReconcileLock();
  }
}

interface MilestoneWithStatsRow extends MilestoneRow {
  blocks_in_db: string;
  avg_finality_time: number | null;
}

function rowToMilestoneWithStats(row: MilestoneWithStatsRow): MilestoneWithStats {
  return {
    milestoneId: BigInt(row.milestone_id),
    sequenceId: row.sequence_id,
    startBlock: BigInt(row.start_block),
    endBlock: BigInt(row.end_block),
    hash: row.hash,
    proposer: row.proposer,
    timestamp: row.timestamp,
    blocksInDb: parseInt(row.blocks_in_db, 10),
    avgFinalityTime: row.avg_finality_time,
  };
}

// Get milestones with pagination and stats
export async function getMilestonesPaginated(
  page: number,
  limit: number
): Promise<{ milestones: MilestoneWithStats[]; total: number }> {
  const offset = (page - 1) * limit;

  // Get total count
  const countResult = await queryOne<{ count: string }>('SELECT COUNT(*) as count FROM milestones');
  const total = parseInt(countResult?.count ?? '0', 10);

  // Get milestones with block stats
  const rows = await query<MilestoneWithStatsRow>(
    `SELECT
      m.*,
      COALESCE(stats.blocks_in_db, 0) as blocks_in_db,
      stats.avg_finality_time
    FROM milestones m
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) as blocks_in_db,
        AVG(time_to_finality_sec) as avg_finality_time
      FROM blocks b
      WHERE b.block_number BETWEEN m.start_block AND m.end_block
    ) stats ON true
    ORDER BY m.milestone_id DESC
    LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return {
    milestones: rows.map(rowToMilestoneWithStats),
    total,
  };
}

// Get count of unfinalized blocks within milestone coverage (for logging)
export async function getUnfinalizedBlockCount(): Promise<number> {
  // Only count unfinalized blocks that are within milestone coverage range
  // to avoid scanning millions of blocks outside milestone range
  const result = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM blocks b
     WHERE b.finalized = FALSE
       AND b.block_number >= (SELECT COALESCE(MIN(start_block), 0) FROM milestones)
       AND b.block_number <= (SELECT COALESCE(MAX(end_block), 0) FROM milestones)`
  );
  return parseInt(result?.count ?? '0', 10);
}
