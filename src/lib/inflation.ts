import { parseAbi } from 'viem';
import { getEthRpcClient } from './ethRpc';
import { POL_EMISSION_MANAGER_PROXY } from './constants';

// ABI for the POL emission manager contract (only functions we need)
const EMISSION_MANAGER_ABI = parseAbi([
  'function INTEREST_PER_YEAR_LOG2() view returns (uint256)',
  'function START_SUPPLY_1_4_0() view returns (uint256)',
  'function getStartTimestamp() view returns (uint256)',
  'event Upgraded(address indexed implementation)',
]);

export interface ContractInflationParams {
  interestPerYearLog2: bigint;
  startSupply: bigint;
  startTimestamp: bigint;
}

/**
 * Read current inflation parameters from the contract
 */
export async function readInflationParams(
  blockNumber?: bigint
): Promise<ContractInflationParams> {
  const client = getEthRpcClient();

  const [interestPerYearLog2, startSupply, startTimestamp] = await Promise.all([
    client.readContract<bigint>({
      address: POL_EMISSION_MANAGER_PROXY,
      abi: EMISSION_MANAGER_ABI,
      functionName: 'INTEREST_PER_YEAR_LOG2',
      blockNumber,
    }),
    client.readContract<bigint>({
      address: POL_EMISSION_MANAGER_PROXY,
      abi: EMISSION_MANAGER_ABI,
      functionName: 'START_SUPPLY_1_4_0',
      blockNumber,
    }),
    client.readContract<bigint>({
      address: POL_EMISSION_MANAGER_PROXY,
      abi: EMISSION_MANAGER_ABI,
      functionName: 'getStartTimestamp',
      blockNumber,
    }),
  ]);

  return { interestPerYearLog2, startSupply, startTimestamp };
}

/**
 * Get all Upgraded events from the proxy contract
 */
export async function getUpgradeEvents(
  fromBlock: bigint,
  toBlock: bigint | 'latest' = 'latest'
): Promise<Array<{ blockNumber: bigint; implementationAddress: string }>> {
  const client = getEthRpcClient();

  const logs = await client.getLogs({
    address: POL_EMISSION_MANAGER_PROXY,
    event: EMISSION_MANAGER_ABI[3], // Upgraded event
    fromBlock,
    toBlock,
  });

  return logs.map((log) => ({
    blockNumber: log.blockNumber!,
    implementationAddress: (log as unknown as { args: { implementation: string } }).args.implementation,
  }));
}

/**
 * Get the deployment block of the proxy contract
 * This is approximately when POL migration happened
 */
export async function getProxyDeploymentBlock(): Promise<bigint> {
  // POL emission manager was deployed around block 18500000 (Oct 2023)
  // We'll start searching from there
  const APPROXIMATE_DEPLOYMENT = 18500000n;

  const client = getEthRpcClient();

  // Binary search to find first block where contract has code
  let low = APPROXIMATE_DEPLOYMENT - 100000n;
  let high = APPROXIMATE_DEPLOYMENT + 100000n;

  while (low < high) {
    const mid = (low + high) / 2n;
    try {
      await client.readContract<bigint>({
        address: POL_EMISSION_MANAGER_PROXY,
        abi: EMISSION_MANAGER_ABI,
        functionName: 'getStartTimestamp',
        blockNumber: mid,
      });
      high = mid;
    } catch {
      low = mid + 1n;
    }
  }

  return low;
}

/**
 * Fetch all historical inflation rate changes
 */
export async function fetchAllInflationRates(): Promise<Array<{
  blockNumber: bigint;
  blockTimestamp: Date;
  interestPerYearLog2: bigint;
  startSupply: bigint;
  startTimestamp: bigint;
  implementationAddress: string;
}>> {
  const client = getEthRpcClient();

  // Get all upgrade events
  const deploymentBlock = await getProxyDeploymentBlock();
  const upgradeEvents = await getUpgradeEvents(deploymentBlock);

  // Also include the initial deployment (may not have Upgraded event)
  const allBlocks = new Set([deploymentBlock, ...upgradeEvents.map(e => e.blockNumber)]);

  const results: Array<{
    blockNumber: bigint;
    blockTimestamp: Date;
    interestPerYearLog2: bigint;
    startSupply: bigint;
    startTimestamp: bigint;
    implementationAddress: string;
  }> = [];

  // Fetch params at each block
  for (const blockNumber of Array.from(allBlocks).sort((a, b) => Number(a - b))) {
    try {
      const [params, block] = await Promise.all([
        readInflationParams(blockNumber),
        client.getBlock(blockNumber),
      ]);

      const upgradeEvent = upgradeEvents.find(e => e.blockNumber === blockNumber);

      results.push({
        blockNumber,
        blockTimestamp: new Date(Number(block.timestamp) * 1000),
        ...params,
        implementationAddress: upgradeEvent?.implementationAddress || 'initial',
      });
    } catch (error) {
      console.warn(`Failed to read params at block ${blockNumber}:`, error);
    }
  }

  // Deduplicate by interestPerYearLog2 (keep first occurrence of each rate)
  const seen = new Set<string>();
  return results.filter(r => {
    const key = r.interestPerYearLog2.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Check if inflation rate has changed since last known rate
 */
export async function checkForNewInflationRate(
  lastKnownRate: bigint
): Promise<{ changed: boolean; newParams?: ContractInflationParams }> {
  const currentParams = await readInflationParams();

  if (currentParams.interestPerYearLog2 !== lastKnownRate) {
    return { changed: true, newParams: currentParams };
  }

  return { changed: false };
}
