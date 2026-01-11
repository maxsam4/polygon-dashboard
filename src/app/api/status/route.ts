import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { areWorkersRunning } from '@/lib/workers';

export const dynamic = 'force-dynamic';

interface BlockStats {
  min_block: string | null;
  max_block: string | null;
  total_count: string;
  finalized_count: string;
  min_finalized: string | null;
  max_finalized: string | null;
}

interface MilestoneStats {
  min_seq: string | null;
  max_seq: string | null;
  min_start_block: string | null;
  max_end_block: string | null;
  total_count: string;
}

interface GapInfo {
  gap_start: string;
  gap_end: string;
  gap_size: string;
}

export async function GET() {
  try {
    // Get block statistics
    const blockStats = await queryOne<BlockStats>(`
      SELECT
        MIN(block_number)::text as min_block,
        MAX(block_number)::text as max_block,
        COUNT(*)::text as total_count,
        COUNT(*) FILTER (WHERE finalized = true)::text as finalized_count,
        MIN(block_number) FILTER (WHERE finalized = true)::text as min_finalized,
        MAX(block_number) FILTER (WHERE finalized = true)::text as max_finalized
      FROM blocks
    `);

    // Get milestone statistics
    const milestoneStats = await queryOne<MilestoneStats>(`
      SELECT
        MIN(sequence_id)::text as min_seq,
        MAX(sequence_id)::text as max_seq,
        MIN(start_block)::text as min_start_block,
        MAX(end_block)::text as max_end_block,
        COUNT(*)::text as total_count
      FROM milestones
    `);

    // Find block gaps (missing blocks in sequence) - check last 10000 blocks
    const blockGaps = await query<GapInfo>(`
      WITH block_range AS (
        SELECT generate_series(
          GREATEST((SELECT MAX(block_number) - 10000 FROM blocks), (SELECT MIN(block_number) FROM blocks)),
          (SELECT MAX(block_number) FROM blocks)
        ) as block_number
      ),
      missing AS (
        SELECT br.block_number
        FROM block_range br
        LEFT JOIN blocks b ON br.block_number = b.block_number
        WHERE b.block_number IS NULL
      ),
      gaps AS (
        SELECT
          block_number,
          block_number - ROW_NUMBER() OVER (ORDER BY block_number) as grp
        FROM missing
      )
      SELECT
        MIN(block_number)::text as gap_start,
        MAX(block_number)::text as gap_end,
        (MAX(block_number) - MIN(block_number) + 1)::text as gap_size
      FROM gaps
      GROUP BY grp
      ORDER BY MIN(block_number) DESC
      LIMIT 10
    `);

    // Find milestone gaps (missing sequence IDs) - check last 1000 milestones
    const milestoneGaps = await query<GapInfo>(`
      WITH milestone_range AS (
        SELECT generate_series(
          GREATEST((SELECT MAX(sequence_id) - 1000 FROM milestones), (SELECT MIN(sequence_id) FROM milestones)),
          (SELECT MAX(sequence_id) FROM milestones)
        ) as sequence_id
      ),
      missing AS (
        SELECT mr.sequence_id
        FROM milestone_range mr
        LEFT JOIN milestones m ON mr.sequence_id = m.sequence_id
        WHERE m.sequence_id IS NULL
      ),
      gaps AS (
        SELECT
          sequence_id,
          sequence_id - ROW_NUMBER() OVER (ORDER BY sequence_id)::int as grp
        FROM missing
      )
      SELECT
        MIN(sequence_id)::text as gap_start,
        MAX(sequence_id)::text as gap_end,
        (MAX(sequence_id) - MIN(sequence_id) + 1)::text as gap_size
      FROM gaps
      GROUP BY grp
      ORDER BY MIN(sequence_id) DESC
      LIMIT 10
    `);

    // Get reconciliation status
    const reconcileStats = await queryOne<{
      unfinalized_in_milestone_range: string;
      total_unfinalized: string;
    }>(`
      SELECT
        COUNT(*) FILTER (
          WHERE finalized = false
          AND block_number >= (SELECT COALESCE(MIN(start_block), 0) FROM milestones)
          AND block_number <= (SELECT COALESCE(MAX(end_block), 0) FROM milestones)
        )::text as unfinalized_in_milestone_range,
        COUNT(*) FILTER (WHERE finalized = false)::text as total_unfinalized
      FROM blocks
    `);

    // Get latest block and milestone timestamps
    const latestBlock = await queryOne<{ block_number: string; timestamp: Date }>(`
      SELECT block_number::text, timestamp FROM blocks ORDER BY block_number DESC LIMIT 1
    `);

    const latestMilestone = await queryOne<{ sequence_id: string; end_block: string; timestamp: Date }>(`
      SELECT sequence_id::text, end_block::text, timestamp FROM milestones ORDER BY sequence_id DESC LIMIT 1
    `);

    const response = {
      workersRunning: areWorkersRunning(),
      timestamp: new Date().toISOString(),
      blocks: {
        min: blockStats?.min_block ?? null,
        max: blockStats?.max_block ?? null,
        total: parseInt(blockStats?.total_count ?? '0', 10),
        finalized: parseInt(blockStats?.finalized_count ?? '0', 10),
        minFinalized: blockStats?.min_finalized ?? null,
        maxFinalized: blockStats?.max_finalized ?? null,
        unfinalized: parseInt(reconcileStats?.total_unfinalized ?? '0', 10),
        unfinalizedInMilestoneRange: parseInt(reconcileStats?.unfinalized_in_milestone_range ?? '0', 10),
        gaps: blockGaps.map(g => ({
          start: g.gap_start,
          end: g.gap_end,
          size: parseInt(g.gap_size, 10),
        })),
        latest: latestBlock ? {
          blockNumber: latestBlock.block_number,
          timestamp: latestBlock.timestamp.toISOString(),
          age: Math.floor((Date.now() - latestBlock.timestamp.getTime()) / 1000),
        } : null,
      },
      milestones: {
        minSeq: milestoneStats?.min_seq ?? null,
        maxSeq: milestoneStats?.max_seq ?? null,
        minStartBlock: milestoneStats?.min_start_block ?? null,
        maxEndBlock: milestoneStats?.max_end_block ?? null,
        total: parseInt(milestoneStats?.total_count ?? '0', 10),
        gaps: milestoneGaps.map(g => ({
          start: g.gap_start,
          end: g.gap_end,
          size: parseInt(g.gap_size, 10),
        })),
        latest: latestMilestone ? {
          sequenceId: latestMilestone.sequence_id,
          endBlock: latestMilestone.end_block,
          timestamp: latestMilestone.timestamp.toISOString(),
          age: Math.floor((Date.now() - latestMilestone.timestamp.getTime()) / 1000),
        } : null,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch status' },
      { status: 500 }
    );
  }
}
