/**
 * Query the actual emission manager contract on Ethereum to get real values
 * This will help us verify our calculations against on-chain reality
 */

import { ethers } from 'ethers';

const EMISSION_MANAGER_ADDRESS = '0xbC9f74b3b14f460a6c47dCdDFd17411cBc7b6c53';
const POL_TOKEN_ADDRESS = '0x455e53CBB86018Ac2B8092FdCd39d8444aFFC3F6';

// RPC endpoints
const RPC_URLS = [
  'https://ethereum-rpc.publicnode.com',
  'https://rpc.ankr.com/eth',
  'https://eth.drpc.org',
];

// ABI for the functions we need
const EMISSION_MANAGER_ABI = [
  'function START_SUPPLY_1_4_0() view returns (uint256)',
  'function startTimestamp() view returns (uint256)',
  'function inflatedSupplyAfter(uint256 timeElapsed) view returns (uint256)',
  'function INTEREST_PER_YEAR_LOG2() view returns (uint256)',
];

const ERC20_ABI = [
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
];

async function queryContract() {
  console.log('='.repeat(80));
  console.log('QUERYING EMISSION MANAGER CONTRACT ON ETHEREUM');
  console.log('='.repeat(80));
  console.log(`Contract: ${EMISSION_MANAGER_ADDRESS}`);
  console.log();

  // Try each RPC endpoint until one works
  for (const rpcUrl of RPC_URLS) {
    try {
      console.log(`Trying RPC: ${rpcUrl}...`);
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      const emissionManager = new ethers.Contract(
        EMISSION_MANAGER_ADDRESS,
        EMISSION_MANAGER_ABI,
        provider
      );

      const polToken = new ethers.Contract(
        POL_TOKEN_ADDRESS,
        ERC20_ABI,
        provider
      );

      // Query current values
      console.log('\nQuerying contract state...');

      const [startSupply, startTimestamp, currentRate, totalSupply, decimals] = await Promise.all([
        emissionManager.START_SUPPLY_1_4_0(),
        emissionManager.startTimestamp(),
        emissionManager.INTEREST_PER_YEAR_LOG2(),
        polToken.totalSupply(),
        polToken.decimals(),
      ]);

      console.log('\n' + '='.repeat(80));
      console.log('CURRENT ON-CHAIN VALUES:');
      console.log('='.repeat(80));

      const startSupplyPol = ethers.formatUnits(startSupply, decimals);
      const totalSupplyPol = ethers.formatUnits(totalSupply, decimals);
      const issuedPol = parseFloat(totalSupplyPol) - parseFloat(startSupplyPol);

      console.log(`START_SUPPLY_1_4_0: ${startSupplyPol} POL`);
      console.log(`START_SUPPLY_1_4_0 (wei): ${startSupply.toString()}`);
      console.log();
      console.log(`startTimestamp: ${startTimestamp.toString()}`);
      console.log(`startTimestamp (date): ${new Date(Number(startTimestamp) * 1000).toISOString()}`);
      console.log();
      console.log(`INTEREST_PER_YEAR_LOG2: ${currentRate.toString()}`);
      console.log(`INTEREST_PER_YEAR_LOG2 (formatted): ${ethers.formatUnits(currentRate, 18)}`);
      console.log();
      console.log(`Current Total Supply: ${totalSupplyPol} POL`);
      console.log(`Current Total Supply (wei): ${totalSupply.toString()}`);
      console.log();
      console.log(`Total Issued (since last upgrade): ${issuedPol.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} POL`);
      console.log('='.repeat(80));

      // Calculate what supply should be now according to contract
      const now = BigInt(Math.floor(Date.now() / 1000));
      const timeElapsed = now - startTimestamp;

      console.log('\nTesting inflatedSupplyAfter function:');
      console.log(`Time elapsed since last upgrade: ${timeElapsed.toString()} seconds (${Number(timeElapsed) / 86400} days)`);

      const calculatedSupply = await emissionManager.inflatedSupplyAfter(timeElapsed);
      const calculatedSupplyPol = ethers.formatUnits(calculatedSupply, decimals);

      console.log(`Calculated supply from contract: ${calculatedSupplyPol} POL`);
      console.log(`Calculated supply (wei): ${calculatedSupply.toString()}`);

      console.log('\n' + '='.repeat(80));
      console.log('NOTES:');
      console.log('='.repeat(80));
      console.log('- START_SUPPLY_1_4_0 is the supply at the time of the last upgrade (v1.4.0)');
      console.log('- This is when the 2.86% rate started (Dec 20, 2024)');
      console.log('- To calculate total issuance since inception (Oct 2023), we need to:');
      console.log('  1. Get the supply history from previous upgrades');
      console.log('  2. Sum up issuance from each period');
      console.log('='.repeat(80));

      // Success! Exit
      return;
    } catch (error) {
      console.error(`Failed with ${rpcUrl}:`, error instanceof Error ? error.message : String(error));
      console.log('Trying next RPC endpoint...\n');
    }
  }

  console.error('\nAll RPC endpoints failed. Please check your internet connection or try again later.');
  process.exit(1);
}

// Run the query
queryContract().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
