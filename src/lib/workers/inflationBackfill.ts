import { fetchAllInflationRates } from '../inflation';
import {
  hasInflationRates,
  insertInflationRate,
  getInflationRateCount,
} from '../queries/inflation';

let isBackfilling = false;
let lastBackfillError: string | null = null;

/**
 * Run inflation rate backfill if needed
 * This should be called on application startup
 */
export async function runInflationBackfillIfNeeded(): Promise<{
  ran: boolean;
  count: number;
  error?: string;
}> {
  // Check if we already have data
  const hasData = await hasInflationRates();

  if (hasData) {
    const count = await getInflationRateCount();
    console.log(`Inflation backfill skipped: ${count} rates already in database`);
    return { ran: false, count };
  }

  return runInflationBackfill();
}

/**
 * Force run inflation backfill (for manual refresh)
 */
export async function runInflationBackfill(): Promise<{
  ran: boolean;
  count: number;
  error?: string;
}> {
  if (isBackfilling) {
    return { ran: false, count: 0, error: 'Backfill already in progress' };
  }

  isBackfilling = true;
  lastBackfillError = null;

  try {
    console.log('Starting inflation rate backfill from Ethereum mainnet...');

    const rates = await fetchAllInflationRates();
    console.log(`Found ${rates.length} inflation rate changes`);

    for (const rate of rates) {
      await insertInflationRate(rate);
      console.log(`Inserted rate at block ${rate.blockNumber}: ${rate.interestPerYearLog2}`);
    }

    const count = await getInflationRateCount();
    console.log(`Inflation backfill complete: ${count} rates in database`);

    return { ran: true, count };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastBackfillError = message;
    console.error('Inflation backfill failed:', message);
    return { ran: true, count: 0, error: message };
  } finally {
    isBackfilling = false;
  }
}

/**
 * Get backfill status
 */
export function getBackfillStatus(): {
  isBackfilling: boolean;
  lastError: string | null;
} {
  return {
    isBackfilling,
    lastError: lastBackfillError,
  };
}
