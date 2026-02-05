import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { query } from '@/lib/db';
import { getRpcClient } from '@/lib/rpc';
import { calculatePriorityFeeMetrics } from '@/lib/indexers/priorityFeeBackfill';
import { updateBlockPriorityFeesBatch } from '@/lib/queries/blocks';

export const dynamic = 'force-dynamic';

interface MissingBlock {
  blockNumber: bigint;
  timestamp: Date;
  baseFeeGwei: number;
}

/**
 * Get blocks missing priority fee data in a given range.
 */
async function getBlocksMissingPriorityFeesInRange(
  startBlock: bigint,
  endBlock: bigint,
  limit: number = 1000
): Promise<MissingBlock[]> {
  const rows = await query<{
    block_number: string;
    timestamp: Date;
    base_fee_gwei: number;
  }>(
    `SELECT block_number, timestamp, base_fee_gwei
     FROM blocks
     WHERE block_number >= $1 AND block_number <= $2
       AND (avg_priority_fee_gwei IS NULL OR total_priority_fee_gwei IS NULL)
       AND tx_count > 0
     ORDER BY block_number ASC
     LIMIT $3`,
    [startBlock.toString(), endBlock.toString(), limit]
  );

  return rows.map(row => ({
    blockNumber: BigInt(row.block_number),
    timestamp: row.timestamp,
    baseFeeGwei: row.base_fee_gwei,
  }));
}

export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookies();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { startBlock, endBlock, limit = 100 } = body;

    // Validate parameters
    if (startBlock === undefined || endBlock === undefined) {
      return NextResponse.json(
        { error: 'startBlock and endBlock are required' },
        { status: 400 }
      );
    }

    const start = BigInt(startBlock);
    const end = BigInt(endBlock);

    if (start > end) {
      return NextResponse.json(
        { error: 'startBlock must be <= endBlock' },
        { status: 400 }
      );
    }

    if (end - start > 10000n) {
      return NextResponse.json(
        { error: 'Range cannot exceed 10,000 blocks' },
        { status: 400 }
      );
    }

    // Find missing blocks in range
    const missingBlocks = await getBlocksMissingPriorityFeesInRange(start, end, limit);

    if (missingBlocks.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No blocks with missing priority fee data in range',
        processed: 0,
        updated: 0,
      });
    }

    // Fetch receipts and calculate metrics
    const rpc = getRpcClient();
    const blockNumbers = missingBlocks.map(b => b.blockNumber);
    const receiptsMap = await rpc.getBlocksReceipts(blockNumbers);

    const updates: Array<{
      blockNumber: bigint;
      timestamp: Date;
      minPriorityFeeGwei: number;
      maxPriorityFeeGwei: number;
      avgPriorityFeeGwei: number;
      medianPriorityFeeGwei: number;
      totalPriorityFeeGwei: number;
    }> = [];

    for (const block of missingBlocks) {
      const receipts = receiptsMap.get(block.blockNumber);
      if (!receipts || receipts.length === 0) continue;

      const metrics = calculatePriorityFeeMetrics(receipts, block.baseFeeGwei);

      if (metrics.avgPriorityFeeGwei !== null && metrics.totalPriorityFeeGwei !== null) {
        updates.push({
          blockNumber: block.blockNumber,
          timestamp: block.timestamp,
          minPriorityFeeGwei: metrics.minPriorityFeeGwei,
          maxPriorityFeeGwei: metrics.maxPriorityFeeGwei,
          avgPriorityFeeGwei: metrics.avgPriorityFeeGwei,
          medianPriorityFeeGwei: metrics.medianPriorityFeeGwei,
          totalPriorityFeeGwei: metrics.totalPriorityFeeGwei,
        });
      }
    }

    // Update database
    if (updates.length > 0) {
      await updateBlockPriorityFeesBatch(updates);
    }

    console.log(`[Admin Backfill] Processed ${missingBlocks.length} blocks, updated ${updates.length}`);

    return NextResponse.json({
      success: true,
      processed: missingBlocks.length,
      updated: updates.length,
      range: {
        start: startBlock.toString(),
        end: endBlock.toString(),
      },
    });
  } catch (error) {
    console.error('[Admin Backfill] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to backfill priority fees' },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check how many blocks are missing in a range.
 */
export async function GET(request: Request) {
  try {
    const session = await getSessionFromCookies();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startBlock = searchParams.get('startBlock');
    const endBlock = searchParams.get('endBlock');

    // If no range provided, check last 24 hours
    let whereClause: string;
    let params: (string | Date)[];

    if (startBlock && endBlock) {
      const start = BigInt(startBlock);
      const end = BigInt(endBlock);

      if (end - start > 100000n) {
        return NextResponse.json(
          { error: 'Range cannot exceed 100,000 blocks for count query' },
          { status: 400 }
        );
      }

      whereClause = 'block_number >= $1 AND block_number <= $2';
      params = [start.toString(), end.toString()];
    } else {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      whereClause = 'timestamp >= $1';
      params = [oneDayAgo];
    }

    const result = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM blocks
       WHERE ${whereClause}
         AND (avg_priority_fee_gwei IS NULL OR total_priority_fee_gwei IS NULL)
         AND tx_count > 0`,
      params
    );

    return NextResponse.json({
      missingCount: parseInt(result[0].count, 10),
      range: startBlock && endBlock
        ? { start: startBlock, end: endBlock }
        : { last24Hours: true },
    });
  } catch (error) {
    console.error('[Admin Backfill] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get missing count' },
      { status: 500 }
    );
  }
}
