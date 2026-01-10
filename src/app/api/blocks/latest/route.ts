import { NextResponse } from 'next/server';
import { getLatestBlocks, getHighestBlockNumber } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [blocks, latestBlockNumber] = await Promise.all([
      getLatestBlocks(20),
      getHighestBlockNumber(),
    ]);

    const response = {
      blocks: blocks.map((block) => ({
        blockNumber: block.blockNumber.toString(),
        timestamp: block.timestamp.toISOString(),
        blockHash: block.blockHash,
        gasUsed: block.gasUsed.toString(),
        gasLimit: block.gasLimit.toString(),
        gasUsedPercent: Number(block.gasUsed * 100n / block.gasLimit),
        baseFeeGwei: block.baseFeeGwei,
        avgPriorityFeeGwei: block.avgPriorityFeeGwei,
        minPriorityFeeGwei: block.minPriorityFeeGwei,
        maxPriorityFeeGwei: block.maxPriorityFeeGwei,
        txCount: block.txCount,
        blockTimeSec: block.blockTimeSec,
        mgasPerSec: block.mgasPerSec,
        tps: block.tps,
        finalized: block.finalized,
        timeToFinalitySec: block.timeToFinalitySec,
      })),
      latestBlock: latestBlockNumber?.toString() ?? null,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching latest blocks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch latest blocks' },
      { status: 500 }
    );
  }
}
