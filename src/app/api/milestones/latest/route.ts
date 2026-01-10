import { NextResponse } from 'next/server';
import { getLatestMilestone } from '@/lib/queries/milestones';

export const dynamic = 'force-dynamic';

export async function GET() {
  const milestone = await getLatestMilestone();

  if (!milestone) {
    return NextResponse.json({ milestone: null });
  }

  return NextResponse.json({
    milestone: {
      milestoneId: milestone.milestoneId.toString(),
      startBlock: milestone.startBlock.toString(),
      endBlock: milestone.endBlock.toString(),
      blockCount: Number(milestone.endBlock - milestone.startBlock) + 1,
      hash: milestone.hash,
      proposer: milestone.proposer,
      timestamp: milestone.timestamp.toISOString(),
    },
  });
}
