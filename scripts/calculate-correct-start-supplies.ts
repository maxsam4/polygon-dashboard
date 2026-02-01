/**
 * Calculate correct start supplies for each inflation period
 * Each period should start with the supply at the end of the previous period (compounding)
 */

import { exp2 } from '../src/lib/inflationCalc';

const WEI_PER_POL = 10n ** 18n;
const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
const INITIAL_SUPPLY = 10000000000n * WEI_PER_POL; // 10 billion POL in wei

interface Period {
  name: string;
  blockNumber: bigint;
  startTimestamp: bigint;
  interestPerYearLog2: bigint;
  startSupply?: bigint;
}

const periods: Period[] = [
  {
    name: 'Period 1 (Initial 4.26%)',
    blockNumber: 18426253n,
    startTimestamp: 1698261431n, // Oct 25, 2023
    interestPerYearLog2: 42644337408493720n,
    startSupply: INITIAL_SUPPLY,
  },
  {
    name: 'Period 2 (Reduced to 3.56%)',
    blockNumber: 20678332n,
    startTimestamp: 1724846400n, // Aug 28, 2024
    interestPerYearLog2: 35623909730721220n,
  },
  {
    name: 'Period 3 (Current 2.86%)',
    blockNumber: 22884776n,
    startTimestamp: 1734696000n, // Dec 20, 2024
    interestPerYearLog2: 28569152196770890n,
  },
];

/**
 * Calculate supply at a given timestamp using compound interest formula
 */
function calculateSupplyAt(
  timestamp: bigint,
  startSupply: bigint,
  startTimestamp: bigint,
  interestPerYearLog2: bigint
): bigint {
  const timeElapsed = timestamp - startTimestamp;

  if (timeElapsed <= 0n) {
    return startSupply;
  }

  // Calculate exponent: (rate * timeElapsed) / SECONDS_PER_YEAR
  const exponent = (interestPerYearLog2 * timeElapsed) / SECONDS_PER_YEAR;

  // Calculate supply factor: 2^exponent
  const supplyFactor = exp2(exponent);

  // Calculate supply: (supplyFactor * startSupply) / 1e18
  const supply = (supplyFactor * startSupply) / WEI_PER_POL;

  return supply;
}

function weiToPol(wei: bigint): string {
  const pol = Number(wei) / Number(WEI_PER_POL);
  return pol.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

console.log('='.repeat(80));
console.log('CALCULATING CORRECT START SUPPLIES FOR COMPOUND INTEREST');
console.log('='.repeat(80));
console.log();

// Calculate start supplies for each period
for (let i = 0; i < periods.length; i++) {
  const period = periods[i];

  if (i === 0) {
    // First period starts with initial supply
    console.log(`${period.name}`);
    console.log(`  Block: ${period.blockNumber}`);
    console.log(`  Start Timestamp: ${period.startTimestamp} (${new Date(Number(period.startTimestamp) * 1000).toISOString()})`);
    console.log(`  Rate (log2): ${period.interestPerYearLog2}`);
    console.log(`  Start Supply: ${weiToPol(period.startSupply!)} POL`);
    console.log(`  Start Supply (wei): ${period.startSupply}`);
  } else {
    // Subsequent periods start with the supply at the end of the previous period
    const prevPeriod = periods[i - 1];
    const supplyAtUpgrade = calculateSupplyAt(
      period.startTimestamp,
      prevPeriod.startSupply!,
      prevPeriod.startTimestamp,
      prevPeriod.interestPerYearLog2
    );

    period.startSupply = supplyAtUpgrade;

    console.log(`${period.name}`);
    console.log(`  Block: ${period.blockNumber}`);
    console.log(`  Start Timestamp: ${period.startTimestamp} (${new Date(Number(period.startTimestamp) * 1000).toISOString()})`);
    console.log(`  Rate (log2): ${period.interestPerYearLog2}`);
    console.log(`  Start Supply: ${weiToPol(period.startSupply)} POL`);
    console.log(`  Start Supply (wei): ${period.startSupply}`);
    console.log(`  Time elapsed from previous: ${(period.startTimestamp - prevPeriod.startTimestamp) / 86400n} days`);
  }
  console.log();
}

// Calculate current supply (as of now)
console.log('='.repeat(80));
const now = BigInt(Math.floor(Date.now() / 1000));
const currentPeriod = periods[periods.length - 1];
const currentSupply = calculateSupplyAt(
  now,
  currentPeriod.startSupply!,
  currentPeriod.startTimestamp,
  currentPeriod.interestPerYearLog2
);

console.log(`CURRENT SUPPLY (as of ${new Date().toISOString()}):`);
console.log(`  ${weiToPol(currentSupply)} POL`);
console.log(`  ${currentSupply} wei`);
console.log('='.repeat(80));

// Output corrected TypeScript constants
console.log();
console.log('CORRECTED CONSTANTS FOR src/lib/inflation.ts:');
console.log('='.repeat(80));
console.log(`
const INITIAL_SUPPLY = 10000000000n * 1000000000000000000n; // 10 billion POL in wei

export const KNOWN_INFLATION_RATES = [
  {
    blockNumber: ${periods[0].blockNumber}n,
    interestPerYearLog2: ${periods[0].interestPerYearLog2}n,
    blockTimestamp: new Date('2023-10-25T19:37:11Z'),
    startSupply: ${periods[0].startSupply}n,
    startTimestamp: ${periods[0].startTimestamp}n,
  },
  {
    blockNumber: ${periods[1].blockNumber}n,
    interestPerYearLog2: ${periods[1].interestPerYearLog2}n,
    blockTimestamp: new Date('2024-08-28T12:00:00Z'),
    startSupply: ${periods[1].startSupply}n, // Supply at end of Period 1 (COMPOUNDED)
    startTimestamp: ${periods[1].startTimestamp}n,
  },
  {
    blockNumber: ${periods[2].blockNumber}n,
    interestPerYearLog2: ${periods[2].interestPerYearLog2}n,
    blockTimestamp: new Date('2024-12-20T12:00:00Z'),
    startSupply: ${periods[2].startSupply}n, // Supply at end of Period 2 (COMPOUNDED)
    startTimestamp: ${periods[2].startTimestamp}n,
  },
] as const;
`);
