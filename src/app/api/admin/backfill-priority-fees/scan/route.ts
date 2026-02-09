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
 * Find blocks missing priority fee data using timestamp-based filtering.
 * Uses WHERE timestamp >= $cutoff for TimescaleDB chunk pruning (fast on 82M+ rows).
 */
async function getBlocksMissingPriorityFees(
  days: number,
  limit: number
): Promise<MissingBlock[]> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await query<{
    block_number: string;
    timestamp: Date;
    base_fee_gwei: number;
  }>(
    `SELECT block_number, timestamp, base_fee_gwei
     FROM blocks
     WHERE timestamp >= $1
       AND (avg_priority_fee_gwei IS NULL OR total_priority_fee_gwei IS NULL)
       AND tx_count > 0
     ORDER BY block_number ASC
     LIMIT $2`,
    [cutoff, limit]
  );

  return rows.map(row => ({
    blockNumber: BigInt(row.block_number),
    timestamp: row.timestamp,
    baseFeeGwei: row.base_fee_gwei,
  }));
}

/**
 * POST — Find and fill missing priority fee data.
 * Params: { days?: number (default 7, max 35), limit?: number (default 200, max 500), batchSize?: number (default 50, max 50) }
 * Returns: { processed, updated, skipped, remaining, elapsed }
 */
export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookies();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const days = Math.min(Math.max(body.days ?? 7, 1), 35);
    const limit = Math.min(Math.max(body.limit ?? 200, 1), 500);
    const batchSize = Math.min(Math.max(body.batchSize ?? 50, 1), 50);

    const startTime = Date.now();

    // Find missing blocks using timestamp-based query (fast chunk pruning)
    const missingBlocks = await getBlocksMissingPriorityFees(days, limit);

    if (missingBlocks.length === 0) {
      return NextResponse.json({
        processed: 0,
        updated: 0,
        skipped: 0,
        remaining: 0,
        elapsed: `${Date.now() - startTime}ms`,
      });
    }

    // Split into RPC batches
    const rpc = getRpcClient();
    let totalUpdated = 0;
    let totalSkipped = 0;

    for (let i = 0; i < missingBlocks.length; i += batchSize) {
      const batch = missingBlocks.slice(i, i + batchSize);
      const blockNumbers = batch.map(b => b.blockNumber);

      // getBlocksReceipts allows partial failure — failed blocks will be retried on next call
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

      for (const block of batch) {
        const receipts = receiptsMap.get(block.blockNumber);
        if (!receipts || receipts.length === 0) {
          totalSkipped++;
          continue;
        }

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

      if (updates.length > 0) {
        await updateBlockPriorityFeesBatch(updates);
        totalUpdated += updates.length;
      }
    }

    // Get remaining count
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM blocks
       WHERE timestamp >= $1
         AND (avg_priority_fee_gwei IS NULL OR total_priority_fee_gwei IS NULL)
         AND tx_count > 0`,
      [cutoff]
    );
    const remaining = parseInt(result[0].count, 10);

    const elapsed = `${Date.now() - startTime}ms`;
    console.log(`[Admin Scan Backfill] Processed ${missingBlocks.length}, updated ${totalUpdated}, skipped ${totalSkipped}, remaining ${remaining} (${elapsed})`);

    return NextResponse.json({
      processed: missingBlocks.length,
      updated: totalUpdated,
      skipped: totalSkipped,
      remaining,
      elapsed,
    });
  } catch (error) {
    console.error('[Admin Scan Backfill] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to scan and backfill priority fees' },
      { status: 500 }
    );
  }
}

/**
 * GET — Check how many blocks are missing priority fee data.
 * Params: ?days=7 (default 7, max 35)
 * Returns: { missingCount, days, cutoff }
 */
export async function GET(request: Request) {
  try {
    const session = await getSessionFromCookies();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '7', 10), 1), 35);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const result = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM blocks
       WHERE timestamp >= $1
         AND (avg_priority_fee_gwei IS NULL OR total_priority_fee_gwei IS NULL)
         AND tx_count > 0`,
      [cutoff]
    );

    return NextResponse.json({
      missingCount: parseInt(result[0].count, 10),
      days,
      cutoff: cutoff.toISOString(),
    });
  } catch (error) {
    console.error('[Admin Scan Backfill] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get missing count' },
      { status: 500 }
    );
  }
}
