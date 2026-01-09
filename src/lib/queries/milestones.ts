import { query, queryOne } from '../db';
import { Milestone } from '../types';

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
