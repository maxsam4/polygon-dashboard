import { NextRequest, NextResponse } from 'next/server';
import { getSummaryStats } from '@/lib/queries/summaryStats';

export const dynamic = 'force-dynamic';

// Public endpoint (no auth): aggregate summary stats over a time range.
// GET /api/stats?from=<unixSec>&to=<unixSec>
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    if (!fromParam || !toParam) {
      return NextResponse.json(
        { error: 'from and to are required (unix seconds)' },
        { status: 400 }
      );
    }

    const from = Number(fromParam);
    const to = Number(toParam);

    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return NextResponse.json(
        { error: 'from and to must be numeric unix seconds' },
        { status: 400 }
      );
    }

    if (from >= to) {
      return NextResponse.json(
        { error: 'from must be earlier than to' },
        { status: 400 }
      );
    }

    // Clamp to now — the range must not be entirely in the future
    const nowSec = Math.floor(Date.now() / 1000);
    const clampedTo = Math.min(to, nowSec);
    if (from >= clampedTo) {
      return NextResponse.json(
        { error: 'time range is entirely in the future' },
        { status: 400 }
      );
    }

    const stats = await getSummaryStats(from, clampedTo);
    return NextResponse.json(stats);
  } catch (error) {
    console.error('[API] Error fetching summary stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch summary stats' },
      { status: 500 }
    );
  }
}
