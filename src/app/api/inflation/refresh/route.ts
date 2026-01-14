import { NextResponse } from 'next/server';
import { getLatestInflationRate, insertInflationRate } from '@/lib/queries/inflation';
import { readInflationParams } from '@/lib/inflation';
import { getEthRpcClient } from '@/lib/ethRpc';
import { runInflationBackfillIfNeeded } from '@/lib/workers/inflationBackfill';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // First, ensure we have backfilled historical data
    const backfillResult = await runInflationBackfillIfNeeded();

    if (backfillResult.error) {
      return NextResponse.json({
        updated: false,
        error: backfillResult.error,
      });
    }

    // Get latest known rate from DB
    const latestRate = await getLatestInflationRate();

    // Read current on-chain values
    const currentParams = await readInflationParams();
    const client = getEthRpcClient();
    const currentBlockNumber = await client.getBlockNumber();
    const currentBlock = await client.getBlock(currentBlockNumber);

    // Check if rate has changed
    if (latestRate && latestRate.interestPerYearLog2 === currentParams.interestPerYearLog2) {
      return NextResponse.json({
        updated: false,
        currentRate: currentParams.interestPerYearLog2.toString(),
        lastChange: latestRate.blockTimestamp.toISOString(),
        message: 'No change in inflation rate',
      });
    }

    // Rate has changed (or this is first check) - insert new record
    await insertInflationRate({
      blockNumber: currentBlockNumber,
      blockTimestamp: new Date(Number(currentBlock.timestamp) * 1000),
      interestPerYearLog2: currentParams.interestPerYearLog2,
      startSupply: currentParams.startSupply,
      startTimestamp: currentParams.startTimestamp,
      implementationAddress: 'manual-refresh',
    });

    return NextResponse.json({
      updated: true,
      currentRate: currentParams.interestPerYearLog2.toString(),
      lastChange: new Date(Number(currentBlock.timestamp) * 1000).toISOString(),
      message: 'Inflation rate updated',
    });
  } catch (error) {
    console.error('Failed to refresh inflation rate:', error);
    return NextResponse.json(
      { error: 'Failed to refresh inflation rate', details: String(error) },
      { status: 500 }
    );
  }
}
