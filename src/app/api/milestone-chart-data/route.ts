import { NextRequest, NextResponse } from 'next/server';
import { getMilestoneChartData } from '@/lib/queries';
import { ALL_BUCKET_SIZES } from '@/lib/constants';

export const dynamic = 'force-dynamic';

type BucketSize = (typeof ALL_BUCKET_SIZES)[number];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const fromTime = searchParams.get('fromTime');
    const toTime = searchParams.get('toTime');
    const bucketSize = searchParams.get('bucketSize') as BucketSize;
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '500', 10), 10000);

    if (!fromTime || !toTime) {
      return NextResponse.json(
        { error: 'fromTime and toTime are required' },
        { status: 400 }
      );
    }

    if (!ALL_BUCKET_SIZES.includes(bucketSize)) {
      return NextResponse.json(
        { error: `bucketSize must be one of: ${ALL_BUCKET_SIZES.join(', ')}` },
        { status: 400 }
      );
    }

    const fromDate = new Date(parseInt(fromTime, 10) * 1000);
    const toDate = new Date(parseInt(toTime, 10) * 1000);

    const { data, total } = await getMilestoneChartData(fromDate, toDate, bucketSize, page, limit);

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
    console.error('Error fetching milestone chart data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch milestone chart data' },
      { status: 500 }
    );
  }
}
