import { NextRequest, NextResponse } from 'next/server';
import { acknowledgeAnomalies, acknowledgeAllAnomalies, getAnomalyCount } from '@/lib/queries/anomalies';
import { getSessionFromCookies } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Require authentication
    const session = await getSessionFromCookies();
    if (!session) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Handle single id or array of ids
    let updatedCount = 0;

    if (body.all === true) {
      // Acknowledge all anomalies in a time range
      const from = body.from ? new Date(body.from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const to = body.to ? new Date(body.to) : new Date();

      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return NextResponse.json(
          { error: 'Invalid date format' },
          { status: 400 }
        );
      }

      updatedCount = await acknowledgeAllAnomalies({ from, to });
    } else if (body.ids && Array.isArray(body.ids)) {
      // Acknowledge multiple anomalies by ids
      const ids = body.ids.map((id: unknown) => parseInt(String(id), 10)).filter((id: number) => !isNaN(id));
      if (ids.length === 0) {
        return NextResponse.json(
          { error: 'No valid IDs provided' },
          { status: 400 }
        );
      }
      updatedCount = await acknowledgeAnomalies(ids);
    } else if (body.id !== undefined) {
      // Acknowledge single anomaly
      const id = parseInt(String(body.id), 10);
      if (isNaN(id)) {
        return NextResponse.json(
          { error: 'Invalid ID' },
          { status: 400 }
        );
      }
      updatedCount = await acknowledgeAnomalies([id]);
    } else {
      return NextResponse.json(
        { error: 'Must provide id, ids array, or all=true' },
        { status: 400 }
      );
    }

    // Return updated badge count (unacknowledged anomalies in last hour)
    const badgeCount = await getAnomalyCount({
      from: new Date(Date.now() - 60 * 60 * 1000),
      excludeAcknowledged: true,
    });

    return NextResponse.json({
      success: true,
      updatedCount,
      badgeCount,
    });
  } catch (error) {
    console.error('[API] Error acknowledging anomalies:', error);
    return NextResponse.json(
      { error: 'Failed to acknowledge anomalies' },
      { status: 500 }
    );
  }
}
