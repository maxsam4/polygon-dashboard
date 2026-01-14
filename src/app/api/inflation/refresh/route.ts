import { NextResponse } from 'next/server';
import { getLatestInflationRate } from '@/lib/queries/inflation';
import { runInflationBackfillIfNeeded } from '@/lib/workers/inflationBackfill';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // Ensure hardcoded rates are in database
    await runInflationBackfillIfNeeded();

    // Get latest known rate from DB
    const latestRate = await getLatestInflationRate();

    if (!latestRate) {
      return NextResponse.json(
        { error: 'No inflation rates in database' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      currentRate: latestRate.interestPerYearLog2.toString(),
      blockNumber: latestRate.blockNumber.toString(),
      lastChange: latestRate.blockTimestamp.toISOString(),
      message: 'Latest inflation rate from database',
    });
  } catch (error) {
    console.error('Failed to get inflation rate:', error);
    return NextResponse.json(
      { error: 'Failed to get inflation rate', details: String(error) },
      { status: 500 }
    );
  }
}
