/**
 * Verify our calculations match the contract's inflatedSupplyAfter function
 * This will identify any calculation errors
 */

import { ethers } from 'ethers';
import { calculateSupplyAt, exp2 } from '../src/lib/inflationCalc';
import { SECONDS_PER_YEAR, WEI_PER_POL } from '../src/lib/constants';

const EMISSION_MANAGER_ADDRESS = '0xbC9f74b3b14f460a6c47dCdDFd17411cBc7b6c53';
const RPC_URL = 'https://ethereum-rpc.publicnode.com';

const EMISSION_MANAGER_ABI = [
  'function START_SUPPLY_1_4_0() view returns (uint256)',
  'function startTimestamp() view returns (uint256)',
  'function inflatedSupplyAfter(uint256 timeElapsed) view returns (uint256)',
  'function INTEREST_PER_YEAR_LOG2() view returns (uint256)',
];

async function verifyCalculations() {
  console.log('='.repeat(80));
  console.log('VERIFYING CALCULATIONS AGAINST ON-CHAIN CONTRACT');
  console.log('='.repeat(80));
  console.log();

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(EMISSION_MANAGER_ADDRESS, EMISSION_MANAGER_ABI, provider);

  // Get current contract state
  const [startSupply, startTimestamp, interestRate] = await Promise.all([
    contract.START_SUPPLY_1_4_0(),
    contract.startTimestamp(),
    contract.INTEREST_PER_YEAR_LOG2(),
  ]);

  console.log('Contract State (Period 4 - Current):');
  console.log(`  START_SUPPLY_1_4_0: ${ethers.formatUnits(startSupply, 18)} POL`);
  console.log(`  startTimestamp: ${startTimestamp.toString()} (${new Date(Number(startTimestamp) * 1000).toISOString()})`);
  console.log(`  INTEREST_PER_YEAR_LOG2: ${interestRate.toString()}`);
  console.log();

  // Test various time periods
  const testPeriods = [
    { days: 1, label: '1 day' },
    { days: 7, label: '1 week' },
    { days: 30, label: '1 month' },
    { days: 100, label: '100 days' },
    { days: 189, label: '189 days (current elapsed)' },
  ];

  console.log('Testing calculations against contract:');
  console.log('='.repeat(80));

  let allMatch = true;
  let maxError = 0n;

  for (const { days, label } of testPeriods) {
    const timeElapsed = BigInt(days * 86400);

    // Get on-chain result
    const onChainSupply = await contract.inflatedSupplyAfter(timeElapsed);

    // Our calculation
    const timestamp = Number(startTimestamp) + Number(timeElapsed);
    const ourSupply = calculateSupplyAt(timestamp, {
      interestPerYearLog2: BigInt(interestRate.toString()),
      startSupply: BigInt(startSupply.toString()),
      startTimestamp: BigInt(startTimestamp.toString()),
    });

    // Compare
    const diff = ourSupply > onChainSupply
      ? ourSupply - onChainSupply
      : onChainSupply - ourSupply;

    const errorPercent = Number(diff * 10000n / onChainSupply) / 100;
    const match = diff <= onChainSupply / 10000n; // 0.01% tolerance

    if (diff > maxError) maxError = diff;
    if (!match) allMatch = false;

    console.log(`\n${label} (${timeElapsed} seconds):`);
    console.log(`  On-chain:  ${ethers.formatUnits(onChainSupply, 18)} POL`);
    console.log(`  Calculated: ${Number(ourSupply) / 1e18} POL`);
    console.log(`  Difference: ${Number(diff) / 1e18} POL (${errorPercent.toFixed(4)}%)`);
    console.log(`  Status: ${match ? '✓ MATCH' : '✗ MISMATCH'}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log(`Maximum error: ${Number(maxError) / 1e18} POL`);
  console.log(`All calculations match: ${allMatch ? 'YES ✓' : 'NO ✗'}`);
  console.log('='.repeat(80));

  if (!allMatch) {
    console.log('\n❌ CALCULATION ERROR DETECTED');
    console.log('Our exp2 or calculateSupplyAt function has a bug!');
    process.exit(1);
  }

  console.log('\n✅ Our calculations match the contract perfectly!');
  console.log('The 21M POL error must be in the START_SUPPLY values for earlier periods.');
}

verifyCalculations().catch(console.error);
