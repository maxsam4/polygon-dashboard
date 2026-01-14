/**
 * FAILING TEST: Demonstrates the compound interest bug
 *
 * This test documents the root cause of the 573M vs 543M discrepancy:
 * - Current code uses 10B as startSupply for ALL periods (simple interest from origin)
 * - Contract uses compounded supplies (each period starts with previous period's end supply)
 * - Missing the July 9, 2025 upgrade entirely
 *
 * Expected: This test FAILS with current code, PASSES after fix
 */

import { calculateSupplyAt, prepareRatesForCalculation } from '../inflationCalc';
import { getAllKnownInflationRates } from '../inflation';

describe('Compound Interest Bug - EXPECTED TO FAIL', () => {
  test('total supply should match on-chain value of 10,573,562,387 POL', () => {
    // Get current hardcoded rates (wrong - all use 10B start supply)
    const hardcodedRates = getAllKnownInflationRates();
    const rates = prepareRatesForCalculation(hardcodedRates);

    // Calculate supply as of July 9, 2025 (when Period 4 started)
    const july9_2025 = 1752102239; // Actual upgrade timestamp from contract
    const latestRate = rates[rates.length - 1];
    const calculatedSupply = calculateSupplyAt(july9_2025, latestRate);

    // Convert to POL for comparison
    const calculatedSupplyPol = Number(calculatedSupply) / 1e18;

    // Expected on-chain value at July 9, 2025
    const expectedSupplyPol = 10_466_456_329; // START_SUPPLY_1_4_0 from contract

    // This WILL FAIL because we're using wrong start supplies
    // Expected: ~10.47B POL
    // Actual with current code: significantly less due to missing compounding
    expect(calculatedSupplyPol).toBeCloseTo(expectedSupplyPol, -6); // Within 1M POL
  });

  test('current supply (Jan 14, 2026) should match on-chain value of 10,573,562,387 POL', () => {
    const hardcodedRates = getAllKnownInflationRates();
    const rates = prepareRatesForCalculation(hardcodedRates);

    // Calculate current supply
    const now = Math.floor(Date.now() / 1000);
    const latestRate = rates[rates.length - 1];
    const calculatedSupply = calculateSupplyAt(now, latestRate);

    // Convert to POL
    const calculatedSupplyPol = Number(calculatedSupply) / 1e18;

    // Expected on-chain value from our query (taken at a specific time)
    const expectedSupplyPol = 10_573_562_387;

    // Allow 2M POL tolerance due to time elapsed since on-chain query
    // The supply grows continuously, so exact match depends on query timing
    const tolerance = 2_000_000;
    expect(Math.abs(calculatedSupplyPol - expectedSupplyPol)).toBeLessThan(tolerance);
  });

  test('should have 3 periods (Oct 2023, Sep 2024, Jul 2025)', () => {
    const rates = getAllKnownInflationRates();

    // Should have exactly 3 rate periods
    expect(rates.length).toBe(3);
  });

  test('Period 2 should start with on-chain supply (~10.249B)', () => {
    const rates = getAllKnownInflationRates();
    const period2 = rates[1]; // Sep 4, 2024 upgrade

    const startSupplyPol = Number(period2.startSupply) / 1e18;

    // Period 2 starts with actual on-chain totalSupply at upgrade block
    expect(startSupplyPol).toBeCloseTo(10_248_739_753, -6); // Within 1M POL
  });

  test('Period 3 should start with on-chain supply (~10.466B)', () => {
    const rates = getAllKnownInflationRates();
    const period3 = rates[2]; // July 9, 2025 upgrade

    const startSupplyPol = Number(period3.startSupply) / 1e18;

    // Period 3 starts with actual on-chain totalSupply at upgrade block
    expect(startSupplyPol).toBeCloseTo(10_466_456_329, -6); // Within 1M POL
  });
});

describe('Total Issuance Calculation', () => {
  test('total issuance since inception should be 573M POL, not 543M', () => {
    const hardcodedRates = getAllKnownInflationRates();
    const rates = prepareRatesForCalculation(hardcodedRates);

    // Calculate current supply
    const now = Math.floor(Date.now() / 1000);
    const latestRate = rates[rates.length - 1];
    const currentSupply = calculateSupplyAt(now, latestRate);
    const currentSupplyPol = Number(currentSupply) / 1e18;

    // Initial supply was 10B
    const initialSupplyPol = 10_000_000_000;

    // Total issuance = current - initial
    const totalIssuancePol = currentSupplyPol - initialSupplyPol;

    // Expected: 573M POL issued since Oct 2023
    // Current buggy calculation: ~543M POL
    expect(totalIssuancePol).toBeGreaterThan(570_000_000); // WILL FAIL
  });
});
