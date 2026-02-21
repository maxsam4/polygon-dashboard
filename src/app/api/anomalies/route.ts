import { NextRequest, NextResponse } from 'next/server';
import { getAnomalies, getAnomalyCount } from '@/lib/queries/anomalies';
import { AnomalySeverity } from '@/lib/constants';
import { getSessionFromCookies } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Require authentication
    const session = await getSessionFromCookies();
    if (!session) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;

    // Parse query parameters
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const metricType = searchParams.get('metric') || undefined;
    const severityParam = searchParams.get('severity');
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const countOnly = searchParams.get('countOnly') === 'true';

    // Parse dates
    const from = fromParam ? new Date(fromParam) : undefined;
    const to = toParam ? new Date(toParam) : new Date();

    // Validate dates
    if ((from && isNaN(from.getTime())) || isNaN(to.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format' },
        { status: 400 }
      );
    }

    // Parse severity
    const severity = severityParam && (severityParam === 'warning' || severityParam === 'critical')
      ? severityParam as AnomalySeverity
      : undefined;

    // If countOnly, just return the count
    if (countOnly) {
      const counts = await getAnomalyCount({ from, to, severity });
      return NextResponse.json(counts);
    }

    // For non-count queries, default to 24 hours if no from provided
    const queryFrom = from ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Parse acknowledged filter
    const acknowledgedParam = searchParams.get('acknowledged');
    const acknowledged = acknowledgedParam === 'true' ? true : acknowledgedParam === 'false' ? false : undefined;

    // Parse pagination
    const limit = limitParam ? parseInt(limitParam, 10) : 100;
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

    // Validate pagination
    if (isNaN(limit) || limit < 1 || limit > 1000) {
      return NextResponse.json(
        { error: 'Invalid limit (must be 1-1000)' },
        { status: 400 }
      );
    }
    if (isNaN(offset) || offset < 0) {
      return NextResponse.json(
        { error: 'Invalid offset (must be >= 0)' },
        { status: 400 }
      );
    }

    // Fetch anomalies
    const { anomalies, total } = await getAnomalies({
      from: queryFrom,
      to,
      metricType,
      severity,
      acknowledged,
      limit,
      offset,
    });

    // Also get counts for the stats header (include acknowledged alerts in total stats)
    const counts = await getAnomalyCount({ from: queryFrom, to, excludeAcknowledged: false });

    // Serialize anomalies (convert BigInt to string)
    const serializedAnomalies = anomalies.map(a => ({
      id: a.id,
      timestamp: a.timestamp.toISOString(),
      metricType: a.metricType,
      severity: a.severity,
      value: a.value,
      expectedValue: a.expectedValue,
      threshold: a.threshold,
      startBlockNumber: a.startBlockNumber?.toString() ?? null,
      endBlockNumber: a.endBlockNumber?.toString() ?? null,
      createdAt: a.createdAt.toISOString(),
      acknowledged: a.acknowledged,
      acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
    }));

    return NextResponse.json({
      anomalies: serializedAnomalies,
      total,
      limit,
      offset,
      stats: counts,
    });
  } catch (error) {
    console.error('[API] Error fetching anomalies:', error);
    return NextResponse.json(
      { error: 'Failed to fetch anomalies' },
      { status: 500 }
    );
  }
}
