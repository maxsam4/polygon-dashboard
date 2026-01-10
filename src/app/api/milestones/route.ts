import { NextRequest, NextResponse } from 'next/server';
import { getMilestonesPaginated } from '@/lib/queries/milestones';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);

  const { milestones, total } = await getMilestonesPaginated(page, limit);

  return NextResponse.json({
    milestones: milestones.map((m) => ({
      milestoneId: m.milestoneId.toString(),
      startBlock: m.startBlock.toString(),
      endBlock: m.endBlock.toString(),
      blockCount: Number(m.endBlock - m.startBlock) + 1,
      hash: m.hash,
      proposer: m.proposer,
      timestamp: m.timestamp.toISOString(),
      blocksInDb: m.blocksInDb,
      avgFinalityTime: m.avgFinalityTime,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
