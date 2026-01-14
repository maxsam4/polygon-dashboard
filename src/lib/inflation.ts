/**
 * Hardcoded historical inflation rate changes
 * These represent the INTEREST_PER_YEAR_LOG2 values at different upgrade blocks
 * User can add new entries via the status page UI
 *
 * IMPORTANT: Each period uses COMPOUNDED supply (not the original 10B)
 * When the contract is upgraded, reinitialize() sets START_SUPPLY_1_4_0 = token.totalSupply()
 * This means each period compounds on the previous period's ending supply.
 *
 * All values verified against on-chain data via archive node queries.
 */
const INITIAL_SUPPLY = 10000000000n * 1000000000000000000n; // 10 billion POL in wei

export const KNOWN_INFLATION_RATES = [
  {
    blockNumber: 18426253n,
    interestPerYearLog2: 42644337408493720n, // 0.04264433740849372e18 - Initial 4.26% rate
    blockTimestamp: new Date('2023-10-25T09:06:23Z'),  // Actual block timestamp from chain
    startSupply: INITIAL_SUPPLY, // Initial deployment: 10B POL (verified on-chain)
    startTimestamp: 1698224783n, // Actual block timestamp from chain
    implementationAddress: 'initial-deployment',
  },
  {
    blockNumber: 20678332n,
    interestPerYearLog2: 35623909730721220n, // 0.03562390973072122e18 - Reduced to 3.56%
    blockTimestamp: new Date('2024-09-04T16:11:59Z'), // Actual block timestamp from chain
    startSupply: 10248739753465028590240000886n, // Actual totalSupply at upgrade block (verified on-chain)
    startTimestamp: 1725466319n, // Actual block timestamp from chain
    implementationAddress: 'upgrade-1',
  },
  {
    blockNumber: 22884776n,
    interestPerYearLog2: 28569152196770890n, // 0.02856915219677089e18 - Reduced to 2.86%
    blockTimestamp: new Date('2025-07-09T23:03:59Z'), // Actual block timestamp from chain
    startSupply: 10466456329199769051012729173n, // Actual totalSupply at upgrade block (verified on-chain)
    startTimestamp: 1752102239n, // Actual block timestamp from chain (current period)
    implementationAddress: 'upgrade-2',
  },
] as const;

export interface InflationRateEntry {
  blockNumber: bigint;
  blockTimestamp: Date;
  interestPerYearLog2: bigint;
  startSupply: bigint;
  startTimestamp: bigint;
  implementationAddress: string;
}

/**
 * Get all historical inflation rates (hardcoded + any added by user)
 * Returns the hardcoded known rates for initial backfill
 */
export function getAllKnownInflationRates(): InflationRateEntry[] {
  return KNOWN_INFLATION_RATES.map(rate => ({
    blockNumber: rate.blockNumber,
    blockTimestamp: rate.blockTimestamp,
    interestPerYearLog2: rate.interestPerYearLog2,
    startSupply: rate.startSupply,
    startTimestamp: rate.startTimestamp,
    implementationAddress: rate.implementationAddress,
  }));
}
