import { NextResponse } from 'next/server';
import { getAllInflationRates } from '@/lib/queries/inflation';
import { InflationRateResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rates = await getAllInflationRates();

    const response: InflationRateResponse[] = rates.map(rate => ({
      blockNumber: rate.blockNumber.toString(),
      blockTimestamp: rate.blockTimestamp.toISOString(),
      interestPerYearLog2: rate.interestPerYearLog2.toString(),
      startSupply: rate.startSupply.toString(),
      startTimestamp: rate.startTimestamp.toString(),
    }));

    return NextResponse.json({
      rates: response,
      count: response.length,
    });
  } catch (error) {
    console.error('Failed to fetch inflation rates:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inflation rates' },
      { status: 500 }
    );
  }
}
