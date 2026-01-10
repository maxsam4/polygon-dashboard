import { NextRequest, NextResponse } from 'next/server';
import { getBlocksPaginated } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 10000);
    const fromBlock = searchParams.get('fromBlock');
    const toBlock = searchParams.get('toBlock');

    const { blocks, total } = await getBlocksPaginated(
      page,
      limit,
      fromBlock ? BigInt(fromBlock) : undefined,
      toBlock ? BigInt(toBlock) : undefined
    );

    const response = {
      blocks: blocks.map((block) => ({
        blockNumber: block.blockNumber.toString(),
        timestamp: block.timestamp.toISOString(),
        blockHash: block.blockHash,
        gasUsed: block.gasUsed.toString(),
        gasLimit: block.gasLimit.toString(),
        gasUsedPercent: (Number(block.gasUsed) / Number(block.gasLimit)) * 100,
        baseFeeGwei: block.baseFeeGwei,
        avgPriorityFeeGwei: block.avgPriorityFeeGwei,
        medianPriorityFeeGwei: block.medianPriorityFeeGwei,
        minPriorityFeeGwei: block.minPriorityFeeGwei,
        maxPriorityFeeGwei: block.maxPriorityFeeGwei,
        totalBaseFeeGwei: block.totalBaseFeeGwei,
        totalPriorityFeeGwei: block.totalPriorityFeeGwei,
        txCount: block.txCount,
        blockTimeSec: block.blockTimeSec,
        mgasPerSec: block.mgasPerSec,
        tps: block.tps,
        finalized: block.finalized,
        finalizedAt: block.finalizedAt?.toISOString() ?? null,
        timeToFinalitySec: block.timeToFinalitySec,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching blocks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch blocks' },
      { status: 500 }
    );
  }
}
