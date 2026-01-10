import { query, queryOne } from '../db';
import { Milestone, MilestoneWithStats } from '../types';

interface MilestoneRow {
  milestone_id: string;
  start_block: string;
  end_block: string;
  hash: string;
  proposer: string | null;
  timestamp: Date;
}

function rowToMilestone(row: MilestoneRow): Milestone {
  return {
    milestoneId: BigInt(row.milestone_id),
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
    `INSERT INTO milestones (milestone_id, start_block, end_block, hash, proposer, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (milestone_id) DO NOTHING`,
    [
      milestone.milestoneId.toString(),
      milestone.startBlock.toString(),
      milestone.endBlock.toString(),
      milestone.hash,
      milestone.proposer,
      milestone.timestamp,
    ]
  );
}

export async function getLowestMilestoneId(): Promise<bigint | null> {
  const row = await queryOne<{ min: string }>(`SELECT MIN(milestone_id) as min FROM milestones`);
  return row?.min ? BigInt(row.min) : null;
}

export async function getHighestMilestoneId(): Promise<bigint | null> {
  const row = await queryOne<{ max: string }>(`SELECT MAX(milestone_id) as max FROM milestones`);
  return row?.max ? BigInt(row.max) : null;
}

// Reconcile all unfinalized blocks that have a matching milestone
export async function reconcileUnfinalizedBlocks(): Promise<number> {
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
      RETURNING 1
    )
    SELECT COUNT(*) as count FROM updated`
  );
  return parseInt(result[0]?.count ?? '0', 10);
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

interface MilestoneWithStatsRow extends MilestoneRow {
  blocks_in_db: string;
  avg_finality_time: number | null;
}

function rowToMilestoneWithStats(row: MilestoneWithStatsRow): MilestoneWithStats {
  return {
    milestoneId: BigInt(row.milestone_id),
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

// Get count of unfinalized blocks
export async function getUnfinalizedBlockCount(): Promise<number> {
  const result = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM blocks WHERE finalized = FALSE'
  );
  return parseInt(result?.count ?? '0', 10);
}
