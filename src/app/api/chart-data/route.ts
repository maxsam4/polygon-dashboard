import { NextRequest, NextResponse } from 'next/server';
import { getChartData } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const VALID_BUCKET_SIZES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const;
type BucketSize = (typeof VALID_BUCKET_SIZES)[number];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const fromTime = searchParams.get('fromTime');
    const toTime = searchParams.get('toTime');
    const bucketSize = searchParams.get('bucketSize') as BucketSize;
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '500', 10), 1000);

    if (!fromTime || !toTime) {
      return NextResponse.json(
        { error: 'fromTime and toTime are required' },
        { status: 400 }
      );
    }

    if (!VALID_BUCKET_SIZES.includes(bucketSize)) {
      return NextResponse.json(
        { error: `bucketSize must be one of: ${VALID_BUCKET_SIZES.join(', ')}` },
        { status: 400 }
      );
    }

    const fromDate = new Date(parseInt(fromTime, 10) * 1000);
    const toDate = new Date(parseInt(toTime, 10) * 1000);

    const { data, total } = await getChartData(fromDate, toDate, bucketSize, page, limit);

    return NextResponse.json({
      bucketSize,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching chart data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch chart data' },
      { status: 500 }
    );
  }
}
