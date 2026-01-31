import { NextResponse } from 'next/server';
import { getRecentReorgedBlocks, getReorgStats } from '@/lib/indexers/reorgHandler';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [reorgs, stats] = await Promise.all([
      getRecentReorgedBlocks(100),
      getReorgStats(),
    ]);

    // Serialize BigInt values
    const serializedReorgs = reorgs.map(r => ({
      id: r.id,
      blockNumber: r.blockNumber.toString(),
      timestamp: r.timestamp.toISOString(),
      blockHash: r.blockHash,
      reorgedAt: r.reorgedAt.toISOString(),
      reason: r.reason,
      replacedByHash: r.replacedByHash,
    }));

    return NextResponse.json({
      reorgs: serializedReorgs,
      stats,
    });
  } catch (error) {
    console.error('[API] Error fetching reorgs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reorgs' },
      { status: 500 }
    );
  }
}
