import { SECONDS_PER_YEAR, WEI_PER_POL } from './constants';

export interface InflationRateParams {
  interestPerYearLog2: bigint;
  startSupply: bigint;
  startTimestamp: bigint;
  nextChangeTimestamp?: number;
}

/**
 * Fixed-point exp2 (2^x) implementation matching the on-chain PowUtil.exp2
 * Input x is in 1e18 fixed-point (1e18 = 1.0)
 * Output is also in 1e18 fixed-point
 *
 * Uses the identity: 2^x = 2^floor(x) * 2^frac(x)
 * The fractional part uses Taylor series approximation
 */
export function exp2(x: bigint): bigint {
  if (x === 0n) return WEI_PER_POL;

  const ONE = WEI_PER_POL;

  // Split into integer and fractional parts
  const intPart = x / ONE;
  const fracPart = x % ONE;

  // Calculate 2^intPart by shifting
  let result = ONE;
  if (intPart > 0n) {
    result = ONE << intPart;
  }

  // Calculate 2^fracPart using the identity: 2^f = e^(f * ln(2))
  // ln(2) ≈ 0.693147... in 1e18 = 693147180559945309n
  if (fracPart > 0n) {
    const LN2 = 693147180559945309n;
    const expArg = (fracPart * LN2) / ONE;

    // Taylor series for e^x: 1 + x + x^2/2! + x^3/3! + ...
    let term = ONE;
    let sum = ONE;

    for (let i = 1n; i <= 20n; i++) {
      term = (term * expArg) / (i * ONE);
      sum += term;
      if (term === 0n) break;
    }

    result = (result * sum) / ONE;
  }

  return result;
}

/**
 * Calculate total POL supply at a given timestamp
 * Replicates the on-chain formula:
 *   supplyFactor = exp2((INTEREST_PER_YEAR_LOG2 * timeElapsed) / 365 days)
 *   supply = (supplyFactor * START_SUPPLY) / 1e18
 */
export function calculateSupplyAt(
  timestamp: number,
  params: InflationRateParams
): bigint {
  const timeElapsed = BigInt(timestamp) - params.startTimestamp;

  if (timeElapsed <= 0n) {
    return params.startSupply;
  }

  // Calculate exponent: (rate * timeElapsed) / SECONDS_PER_YEAR
  const exponent = (params.interestPerYearLog2 * timeElapsed) / SECONDS_PER_YEAR;

  // Calculate supply factor: 2^exponent
  const supplyFactor = exp2(exponent);

  // Calculate supply: (supplyFactor * startSupply) / 1e18
  const supply = (supplyFactor * params.startSupply) / WEI_PER_POL;

  return supply;
}

/**
 * Find which inflation rate was active at a given timestamp
 */
export function findRateAt(
  timestamp: number,
  rates: InflationRateParams[]
): InflationRateParams | null {
  if (rates.length === 0) return null;

  // Rates should be sorted by startTimestamp ascending
  // Find the last rate where startTimestamp <= timestamp
  let activeRate: InflationRateParams | null = null;

  for (const rate of rates) {
    if (Number(rate.startTimestamp) <= timestamp) {
      activeRate = rate;
    } else {
      break;
    }
  }

  return activeRate;
}

/**
 * Calculate issuance for a time bucket
 * Fast path: single rate for entire bucket (99.9% of cases)
 * Slow path: rate change mid-bucket (rare)
 */
export function calculateBucketIssuance(
  bucketStart: number,
  bucketEnd: number,
  rates: InflationRateParams[]
): bigint {
  const activeRate = findRateAt(bucketStart, rates);
  if (!activeRate) return 0n;

  const nextChange = activeRate.nextChangeTimestamp;

  // Fast path: no rate change in this bucket
  if (!nextChange || nextChange > bucketEnd) {
    const supplyStart = calculateSupplyAt(bucketStart, activeRate);
    const supplyEnd = calculateSupplyAt(bucketEnd, activeRate);
    return supplyEnd - supplyStart;
  }

  // Slow path: rate change mid-bucket
  return calculateIssuanceWithSplits(bucketStart, bucketEnd, rates);
}

/**
 * Calculate issuance when bucket spans multiple rate periods
 */
function calculateIssuanceWithSplits(
  bucketStart: number,
  bucketEnd: number,
  rates: InflationRateParams[]
): bigint {
  let totalIssuance = 0n;
  let currentTime = bucketStart;

  for (const rate of rates) {
    const rateStart = Number(rate.startTimestamp);
    const rateEnd = rate.nextChangeTimestamp ?? Infinity;

    // Skip rates that end before our bucket starts
    if (rateEnd <= currentTime) continue;

    // Stop if rate starts after our bucket ends
    if (rateStart >= bucketEnd) break;

    // Calculate segment boundaries
    const segmentStart = Math.max(currentTime, rateStart);
    const segmentEnd = Math.min(bucketEnd, rateEnd);

    if (segmentStart < segmentEnd) {
      const supplyStart = calculateSupplyAt(segmentStart, rate);
      const supplyEnd = calculateSupplyAt(segmentEnd, rate);
      totalIssuance += supplyEnd - supplyStart;
      currentTime = segmentEnd;
    }
  }

  return totalIssuance;
}

/**
 * Convert inflation rates from API response to calculation params
 * Adds nextChangeTimestamp for efficient bucket calculations
 */
export function prepareRatesForCalculation(
  rates: Array<{
    startTimestamp: string | bigint;
    interestPerYearLog2: string | bigint;
    startSupply: string | bigint;
  }>
): InflationRateParams[] {
  const sorted = [...rates].sort((a, b) =>
    Number(BigInt(a.startTimestamp)) - Number(BigInt(b.startTimestamp))
  );

  return sorted.map((rate, index) => ({
    interestPerYearLog2: BigInt(rate.interestPerYearLog2),
    startSupply: BigInt(rate.startSupply),
    startTimestamp: BigInt(rate.startTimestamp),
    nextChangeTimestamp: index < sorted.length - 1
      ? Number(BigInt(sorted[index + 1].startTimestamp))
      : undefined,
  }));
}

/**
 * Convert wei to POL (divide by 1e18)
 */
export function weiToPol(wei: bigint): number {
  return Number(wei) / Number(WEI_PER_POL);
}

/**
 * Calculate annualized rate from a period
 */
export function annualize(value: number, periodSeconds: number): number {
  const secondsPerYear = Number(SECONDS_PER_YEAR);
  return value * (secondsPerYear / periodSeconds);
}
