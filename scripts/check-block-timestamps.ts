/**
 * Get actual timestamps for upgrade blocks to identify the correct periods
 */

import { ethers } from 'ethers';

const RPC_URL = 'https://ethereum-rpc.publicnode.com';

const BLOCKS_TO_CHECK = [
  { block: 18426253, label: 'Period 1 (supposed Oct 25, 2023)' },
  { block: 20678332, label: 'Period 2 (supposed Aug 28, 2024)' },
  { block: 22884776, label: 'Period 3 (supposed Dec 20, 2024???)' },
];

async function checkBlockTimestamps() {
  console.log('='.repeat(80));
  console.log('VERIFYING ACTUAL BLOCK TIMESTAMPS');
  console.log('='.repeat(80));
  console.log();

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  for (const { block, label } of BLOCKS_TO_CHECK) {
    try {
      const blockData = await provider.getBlock(block);

      if (blockData) {
        const date = new Date(blockData.timestamp * 1000);
        console.log(`${label}`);
        console.log(`  Block: ${block}`);
        console.log(`  Actual Timestamp: ${blockData.timestamp}`);
        console.log(`  Actual Date: ${date.toISOString()}`);
        console.log();
      }
    } catch (error) {
      console.log(`  ✗ Failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  console.log('='.repeat(80));
}

checkBlockTimestamps().catch(console.error);
