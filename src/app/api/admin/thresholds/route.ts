import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getAllMetricThresholds, updateMetricThreshold } from '@/lib/queries/anomalies';
import { clearThresholdCache } from '@/lib/anomalyDetector';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSessionFromCookies();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const thresholds = await getAllMetricThresholds();
    return NextResponse.json({ thresholds });
  } catch (error) {
    console.error('[Admin Thresholds] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch thresholds' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getSessionFromCookies();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { metricType, warningLow, warningHigh, criticalLow, criticalHigh, minConsecutiveBlocks } = body;

    if (!metricType) {
      return NextResponse.json(
        { error: 'metricType is required' },
        { status: 400 }
      );
    }

    // Validate the metric type
    const validMetricTypes = ['gas_price', 'block_time', 'finality', 'tps', 'mgas'];
    if (!validMetricTypes.includes(metricType)) {
      return NextResponse.json(
        { error: `Invalid metric type. Valid types: ${validMetricTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate minConsecutiveBlocks if provided
    if (minConsecutiveBlocks !== undefined && minConsecutiveBlocks !== null) {
      if (!Number.isInteger(minConsecutiveBlocks) || minConsecutiveBlocks < 1) {
        return NextResponse.json(
          { error: 'minConsecutiveBlocks must be a positive integer' },
          { status: 400 }
        );
      }
    }

    // Update the threshold
    const updated = await updateMetricThreshold(metricType, {
      warningLow: warningLow ?? null,
      warningHigh: warningHigh ?? null,
      criticalLow: criticalLow ?? null,
      criticalHigh: criticalHigh ?? null,
      minConsecutiveBlocks: minConsecutiveBlocks ?? 1,
    });

    // Clear the cache so changes take effect immediately
    clearThresholdCache();

    return NextResponse.json({
      success: true,
      threshold: updated,
    });
  } catch (error) {
    console.error('[Admin Thresholds] PUT error:', error);
    return NextResponse.json(
      { error: 'Failed to update threshold' },
      { status: 500 }
    );
  }
}
