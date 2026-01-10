import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { BlockRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MAX_EXPORT_LIMIT = 50000;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '10000', 10), MAX_EXPORT_LIMIT);
    const fromBlock = searchParams.get('fromBlock');
    const toBlock = searchParams.get('toBlock');
    const fromTime = searchParams.get('fromTime');
    const toTime = searchParams.get('toTime');

    // Build query
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (fromBlock) {
      conditions.push(`block_number >= $${paramIndex++}`);
      params.push(fromBlock);
    }
    if (toBlock) {
      conditions.push(`block_number <= $${paramIndex++}`);
      params.push(toBlock);
    }
    if (fromTime) {
      conditions.push(`timestamp >= $${paramIndex++}`);
      params.push(fromTime);
    }
    if (toTime) {
      conditions.push(`timestamp <= $${paramIndex++}`);
      params.push(toTime);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count first
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM blocks ${whereClause}`,
      params
    );
    const total = parseInt(countResult[0]?.count ?? '0', 10);

    // Fetch blocks
    const rows = await query<BlockRow>(
      `SELECT * FROM blocks ${whereClause} ORDER BY block_number DESC LIMIT $${paramIndex}`,
      [...params, limit]
    );

    // Transform to export format
    const blocks = rows.map((row) => ({
      blockNumber: row.block_number,
      timestamp: row.timestamp.toISOString(),
      gasUsedPercent: Number((BigInt(row.gas_used) * 10000n / BigInt(row.gas_limit))) / 100,
      baseFeeGwei: row.base_fee_gwei,
      avgPriorityFeeGwei: row.avg_priority_fee_gwei,
      medianPriorityFeeGwei: row.median_priority_fee_gwei,
      minPriorityFeeGwei: row.min_priority_fee_gwei,
      maxPriorityFeeGwei: row.max_priority_fee_gwei,
      txCount: row.tx_count,
      gasUsed: row.gas_used,
      gasLimit: row.gas_limit,
      blockTimeSec: row.block_time_sec,
      mgasPerSec: row.mgas_per_sec,
      tps: row.tps,
      totalBaseFeeGwei: row.total_base_fee_gwei,
      totalPriorityFeeGwei: row.total_priority_fee_gwei,
      finalized: row.finalized,
      timeToFinalitySec: row.time_to_finality_sec,
    }));

    return NextResponse.json({
      blocks,
      total,
      limit,
      truncated: total > limit,
    });
  } catch (error) {
    console.error('Error exporting blocks:', error);
    return NextResponse.json(
      { error: 'Failed to export blocks' },
      { status: 500 }
    );
  }
}
