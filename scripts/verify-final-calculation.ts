/**
 * Verify that with the corrected start supplies and timestamps,
 * our calculation now matches the on-chain value precisely
 */

import { calculateSupplyAt, prepareRatesForCalculation } from '../src/lib/inflationCalc';
import { getAllKnownInflationRates } from '../src/lib/inflation';

console.log('='.repeat(80));
console.log('VERIFYING FINAL CALCULATION WITH CORRECTED VALUES');
console.log('='.repeat(80));
console.log();

const rates = getAllKnownInflationRates();
console.log(`Loaded ${rates.length} inflation rate periods\n`);

// Show all periods
rates.forEach((rate, i) => {
  console.log(`Period ${i + 1}:`);
  console.log(`  Block: ${rate.blockNumber.toString()}`);
  console.log(`  Timestamp: ${rate.blockTimestamp.toISOString()}`);
  console.log(`  Start Supply: ${(Number(rate.startSupply) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 2 })} POL`);
  console.log(`  Rate (log2): ${rate.interestPerYearLog2.toString()}`);
  console.log();
});

// Calculate current supply
const preparedRates = prepareRatesForCalculation(rates);
const now = Math.floor(Date.now() / 1000);
const latestRate = preparedRates[preparedRates.length - 1];
const calculatedSupply = calculateSupplyAt(now, latestRate);
const calculatedSupplyPol = Number(calculatedSupply) / 1e18;

console.log('='.repeat(80));
console.log('CURRENT SUPPLY CALCULATION:');
console.log('='.repeat(80));
console.log(`Current Time: ${new Date().toISOString()}`);
console.log(`Calculated Supply: ${calculatedSupplyPol.toLocaleString('en-US', { maximumFractionDigits: 2 })} POL`);
console.log(`Calculated Supply (wei): ${calculatedSupply.toString()}`);
console.log();

// Expected on-chain value (from earlier query)
const expectedSupplyPol = 10_573_562_387;
console.log(`Expected (from on-chain query): ${expectedSupplyPol.toLocaleString('en-US')} POL`);

const diffPol = Math.abs(calculatedSupplyPol - expectedSupplyPol);
const errorPercent = (diffPol / expectedSupplyPol) * 100;

console.log(`\nDifference: ${diffPol.toLocaleString('en-US', { maximumFractionDigits: 2 })} POL`);
console.log(`Error: ${errorPercent.toFixed(6)}%`);

if (errorPercent < 0.01) {
  console.log(`\n✅ SUCCESS: Error < 0.01% - Calculation is accurate!`);
} else if (errorPercent < 0.1) {
  console.log(`\n⚠️  WARNING: Error ${errorPercent.toFixed(4)}% is acceptable but not perfect`);
} else {
  console.log(`\n❌ FAILURE: Error ${errorPercent.toFixed(4)}% is too large`);
  process.exit(1);
}

// Calculate total issuance
const initialSupplyPol = 10_000_000_000;
const totalIssuancePol = calculatedSupplyPol - initialSupplyPol;

console.log('\n' + '='.repeat(80));
console.log('TOTAL ISSUANCE SINCE INCEPTION:');
console.log('='.repeat(80));
console.log(`Initial Supply (Oct 2023): ${initialSupplyPol.toLocaleString('en-US')} POL`);
console.log(`Current Supply: ${calculatedSupplyPol.toLocaleString('en-US', { maximumFractionDigits: 2 })} POL`);
console.log(`Total Issued: ${totalIssuancePol.toLocaleString('en-US', { maximumFractionDigits: 2 })} POL`);
console.log('='.repeat(80));
