import { NextResponse } from 'next/server';
import { insertInflationRate, getAllInflationRates } from '@/lib/queries/inflation';
import { getSessionFromCookies } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const INITIAL_SUPPLY = 10000000000n * 1000000000000000000n; // 10 billion POL in wei

export async function POST(request: Request) {
  try {
    // Verify session authentication
    const session = await getSessionFromCookies();
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized - please log in to admin' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { blockNumber, interestPerYearLog2, blockTimestamp } = body;

    if (!blockNumber || !interestPerYearLog2) {
      return NextResponse.json(
        { error: 'blockNumber and interestPerYearLog2 are required' },
        { status: 400 }
      );
    }

    // Parse inputs
    const blockNum = BigInt(blockNumber);
    const interestRate = BigInt(interestPerYearLog2);

    // Check if this exact rate at this block already exists
    const existingRates = await getAllInflationRates();
    const isDuplicate = existingRates.some(
      r => r.blockNumber === blockNum && r.interestPerYearLog2 === interestRate
    );

    if (isDuplicate) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: 'Rate already exists in database for this block',
        rate: {
          blockNumber: blockNum.toString(),
          interestPerYearLog2: interestRate.toString(),
        },
      });
    }

    // Use provided timestamp or current time
    const timestamp = blockTimestamp ? new Date(blockTimestamp) : new Date();
    const unixTimestamp = BigInt(Math.floor(timestamp.getTime() / 1000));

    // Insert new rate
    const newRate = {
      blockNumber: blockNum,
      blockTimestamp: timestamp,
      interestPerYearLog2: interestRate,
      startSupply: INITIAL_SUPPLY, // Use standard initial supply
      startTimestamp: unixTimestamp, // Unix timestamp when rate became active
    };

    await insertInflationRate(newRate);

    return NextResponse.json({
      success: true,
      duplicate: false,
      message: 'New inflation rate added successfully',
      rate: {
        blockNumber: newRate.blockNumber.toString(),
        interestPerYearLog2: newRate.interestPerYearLog2.toString(),
        blockTimestamp: newRate.blockTimestamp.toISOString(),
      },
    });
  } catch (error) {
    console.error('Scan block error:', error);
    return NextResponse.json(
      { error: 'Failed to add inflation rate', details: String(error) },
      { status: 500 }
    );
  }
}
