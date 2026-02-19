import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getEndpointStats, getMethodStats, getRpcTimeSeries } from '@/lib/queries/rpcStats';

export const dynamic = 'force-dynamic';

const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_RANGE_MS = 60 * 60 * 1000; // 1 hour

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromCookies();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const view = searchParams.get('view') ?? 'summary';
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const bucket = searchParams.get('bucket') ?? '5m';

    const to = toParam ? new Date(toParam) : new Date();
    const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - DEFAULT_RANGE_MS);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      return NextResponse.json({ error: 'Time range must be < 7 days' }, { status: 400 });
    }

    if (view === 'timeseries') {
      const data = await getRpcTimeSeries(from, to, bucket);
      return NextResponse.json({ timeseries: data });
    }

    // Default: summary view — both endpoint and method stats
    const [endpoints, methods] = await Promise.all([
      getEndpointStats(from, to),
      getMethodStats(from, to),
    ]);

    return NextResponse.json({ endpoints, methods });
  } catch (error) {
    console.error('[API] Error fetching RPC stats:', error);
    return NextResponse.json({ error: 'Failed to fetch RPC stats' }, { status: 500 });
  }
}
