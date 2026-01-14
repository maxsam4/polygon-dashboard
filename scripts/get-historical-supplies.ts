/**
 * Query actual POL token totalSupply() at each historical upgrade block
 * This gives us the REAL start supplies used on-chain
 */

import { ethers } from 'ethers';

const POL_TOKEN_ADDRESS = '0x455e53CBB86018Ac2B8092FdCd39d8444aFFC3F6';
const RPC_URL = 'https://ethereum-rpc.publicnode.com';

const ERC20_ABI = [
  'function totalSupply() view returns (uint256)',
];

interface UpgradeBlock {
  period: string;
  blockNumber: number;
  timestamp: string;
  description: string;
}

const UPGRADE_BLOCKS: UpgradeBlock[] = [
  {
    period: 'Period 1',
    blockNumber: 18426253,
    timestamp: '2023-10-25T19:17:11Z',
    description: 'Initial deployment (4.26% rate)',
  },
  {
    period: 'Period 2',
    blockNumber: 20678332,
    timestamp: '2024-08-28T12:00:00Z',
    description: 'Upgrade to 3.56% rate',
  },
  {
    period: 'Period 3',
    blockNumber: 22884776,
    timestamp: '2024-12-20T12:00:00Z',
    description: 'Upgrade to 2.86% rate',
  },
  // Period 4 we already have from the current contract query
];

async function getHistoricalSupplies() {
  console.log('='.repeat(80));
  console.log('QUERYING ACTUAL POL TOTALSUPPLY AT EACH UPGRADE BLOCK');
  console.log('='.repeat(80));
  console.log();

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const token = new ethers.Contract(POL_TOKEN_ADDRESS, ERC20_ABI, provider);

  console.log('⚠️  Note: Requires archive node access for historical state queries');
  console.log('If this fails, the RPC endpoint does not support archive queries\n');

  for (const upgrade of UPGRADE_BLOCKS) {
    console.log(`${upgrade.period}: ${upgrade.description}`);
    console.log(`  Block: ${upgrade.blockNumber}`);
    console.log(`  Timestamp: ${upgrade.timestamp}`);

    try {
      // Query totalSupply at specific block
      const supply = await token.totalSupply({
        blockTag: upgrade.blockNumber,
      });

      const supplyPol = ethers.formatUnits(supply, 18);
      console.log(`  ✓ Total Supply: ${parseFloat(supplyPol).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} POL`);
      console.log(`  ✓ Total Supply (wei): ${supply.toString()}`);
    } catch (error) {
      console.log(`  ✗ Failed to query: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`  → RPC endpoint does not support archive node queries`);
    }
    console.log();
  }

  console.log('='.repeat(80));
  console.log('If queries failed, we need an archive node RPC endpoint.');
  console.log('Alternative: Check Etherscan for historical totalSupply values');
  console.log('='.repeat(80));
}

getHistoricalSupplies().catch(console.error);
