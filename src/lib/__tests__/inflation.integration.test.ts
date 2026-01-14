import { calculateSupplyAt } from '../inflationCalc';
import { readInflationParams } from '../inflation';
import { getEthRpcClient } from '../ethRpc';
import { POL_EMISSION_MANAGER_PROXY } from '../constants';
import { parseAbi } from 'viem';

// Skip in CI - requires Ethereum RPC
const describeIfRpc = process.env.ETH_RPC_URLS ? describe : describe.skip;

describeIfRpc('Inflation calculation vs on-chain', () => {
  const EMISSION_MANAGER_ABI = parseAbi([
    'function inflatedSupplyAfter(uint256 timeElapsed) view returns (uint256)',
  ]);

  test('our calculation matches on-chain inflatedSupplyAfter for 1 year', async () => {
    const client = getEthRpcClient();
    const params = await readInflationParams();

    // Test with 1 year of time elapsed
    const oneYear = 365n * 24n * 60n * 60n;

    // Get on-chain result
    const onChainSupply = await client.readContract<bigint>({
      address: POL_EMISSION_MANAGER_PROXY,
      abi: EMISSION_MANAGER_ABI,
      functionName: 'inflatedSupplyAfter',
      args: [oneYear],
    });

    // Calculate our result
    const timestamp = Number(params.startTimestamp) + Number(oneYear);
    const ourSupply = calculateSupplyAt(timestamp, {
      interestPerYearLog2: params.interestPerYearLog2,
      startSupply: params.startSupply,
      startTimestamp: params.startTimestamp,
    });

    // Allow 0.01% difference for rounding
    const diff = ourSupply > onChainSupply
      ? ourSupply - onChainSupply
      : onChainSupply - ourSupply;
    const tolerance = onChainSupply / 10000n;

    expect(diff <= tolerance).toBe(true);
  }, 30000);

  test('our calculation matches on-chain for various time periods', async () => {
    const client = getEthRpcClient();
    const params = await readInflationParams();

    const testPeriods = [
      1n * 24n * 60n * 60n,    // 1 day
      7n * 24n * 60n * 60n,    // 1 week
      30n * 24n * 60n * 60n,   // 1 month
      365n * 24n * 60n * 60n,  // 1 year
    ];

    for (const period of testPeriods) {
      const onChainSupply = await client.readContract<bigint>({
        address: POL_EMISSION_MANAGER_PROXY,
        abi: EMISSION_MANAGER_ABI,
        functionName: 'inflatedSupplyAfter',
        args: [period],
      });

      const timestamp = Number(params.startTimestamp) + Number(period);
      const ourSupply = calculateSupplyAt(timestamp, {
        interestPerYearLog2: params.interestPerYearLog2,
        startSupply: params.startSupply,
        startTimestamp: params.startTimestamp,
      });

      const diff = ourSupply > onChainSupply
        ? ourSupply - onChainSupply
        : onChainSupply - ourSupply;
      const tolerance = onChainSupply / 10000n; // 0.01%

      expect(diff <= tolerance).toBe(true);
    }
  }, 60000);
});
