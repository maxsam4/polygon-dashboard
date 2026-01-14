import {
  exp2,
  calculateSupplyAt,
  calculateBucketIssuance,
  InflationRateParams,
} from '../inflationCalc';
import { SECONDS_PER_YEAR } from '../constants';

describe('exp2 - fixed-point 2^x calculation', () => {
  test('exp2(0) = 1e18 (2^0 = 1)', () => {
    expect(exp2(0n)).toBe(10n ** 18n);
  });

  test('exp2(1e18) = 2e18 (2^1 = 2)', () => {
    const result = exp2(10n ** 18n);
    // Allow small rounding error (within 0.01%)
    const expected = 2n * 10n ** 18n;
    const diff = result > expected ? result - expected : expected - result;
    expect(diff < expected / 10000n).toBe(true);
  });

  test('exp2(2e18) ≈ 4e18 (2^2 = 4)', () => {
    const result = exp2(2n * 10n ** 18n);
    const expected = 4n * 10n ** 18n;
    const diff = result > expected ? result - expected : expected - result;
    expect(diff < expected / 10000n).toBe(true);
  });
});

describe('calculateSupplyAt', () => {
  const baseParams: InflationRateParams = {
    interestPerYearLog2: 14016503977010690n, // ~1% annual rate
    startSupply: 10_000_000_000n * 10n ** 18n, // 10B POL
    startTimestamp: 1700000000n, // Some past timestamp
  };

  test('supply at start timestamp equals start supply', () => {
    const supply = calculateSupplyAt(Number(baseParams.startTimestamp), baseParams);
    expect(supply).toBe(baseParams.startSupply);
  });

  test('supply increases over time', () => {
    const oneYearLater = Number(baseParams.startTimestamp) + Number(SECONDS_PER_YEAR);
    const supply = calculateSupplyAt(oneYearLater, baseParams);
    expect(supply > baseParams.startSupply).toBe(true);
  });

  test('supply after one year is approximately startSupply * (1 + rate)', () => {
    const oneYearLater = Number(baseParams.startTimestamp) + Number(SECONDS_PER_YEAR);
    const supply = calculateSupplyAt(oneYearLater, baseParams);
    // With ~1% rate, supply should be ~1.01x
    const ratio = (supply * 10000n) / baseParams.startSupply;
    expect(ratio >= 10090n && ratio <= 10110n).toBe(true); // 1.009 to 1.011
  });
});

describe('calculateBucketIssuance', () => {
  const rates: InflationRateParams[] = [{
    interestPerYearLog2: 14016503977010690n,
    startSupply: 10_000_000_000n * 10n ** 18n,
    startTimestamp: 1700000000n,
    nextChangeTimestamp: undefined,
  }];

  test('issuance over 1 hour is positive', () => {
    const bucketStart = 1700000000;
    const bucketEnd = 1700003600; // 1 hour later
    const issuance = calculateBucketIssuance(bucketStart, bucketEnd, rates);
    expect(issuance > 0n).toBe(true);
  });

  test('longer period has more issuance', () => {
    const start = 1700000000;
    const oneHour = calculateBucketIssuance(start, start + 3600, rates);
    const oneDay = calculateBucketIssuance(start, start + 86400, rates);
    expect(oneDay > oneHour).toBe(true);
  });
});
