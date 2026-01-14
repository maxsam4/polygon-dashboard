# POL Inflation & Issuance Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add POL issuance, net inflation, and total supply charts to the analytics page with frontend-calculated values from on-chain inflation rate data.

**Architecture:** Store inflation rate change events in DB (fetched from Ethereum mainnet via proxy Upgraded events). Frontend fetches rates once, calculates issuance/supply per bucket using the compound formula, combines with existing burn data for net inflation.

**Tech Stack:** TypeScript, viem (Ethereum RPC), PostgreSQL, Next.js API routes, lightweight-charts, Jest for testing

---

## Task 1: Database Migration

**Files:**
- Create: `docker/migrations/20260114_inflation_rates.sql`

**Step 1: Write the migration SQL**

```sql
-- Migration: Create inflation_rates table for storing POL inflation rate changes
-- These are triggered by proxy upgrades on the POL emission manager contract

CREATE TABLE IF NOT EXISTS inflation_rates (
  id SERIAL PRIMARY KEY,
  block_number BIGINT NOT NULL UNIQUE,
  block_timestamp TIMESTAMPTZ NOT NULL,
  interest_per_year_log2 NUMERIC(78, 0) NOT NULL,
  start_supply NUMERIC(78, 0) NOT NULL,
  start_timestamp BIGINT NOT NULL,
  implementation_address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inflation_rates_timestamp
  ON inflation_rates(block_timestamp);

CREATE INDEX IF NOT EXISTS idx_inflation_rates_block
  ON inflation_rates(block_number);
```

**Step 2: Apply migration to local database**

Run: `docker compose exec db psql -U polygon -d polygon_dashboard -f /docker-entrypoint-initdb.d/migrations/20260114_inflation_rates.sql`

Expected: Tables created without error

**Step 3: Verify table exists**

Run: `docker compose exec db psql -U polygon -d polygon_dashboard -c "\d inflation_rates"`

Expected: Table schema displayed

**Step 4: Commit**

```bash
git add docker/migrations/20260114_inflation_rates.sql
git commit -m "feat: add inflation_rates table for POL inflation tracking"
```

---

## Task 2: Add Ethereum RPC Constants

**Files:**
- Modify: `src/lib/constants.ts`

**Step 1: Add Ethereum RPC and contract constants**

Add at the end of `src/lib/constants.ts`:

```typescript
// Ethereum mainnet RPC URLs (for POL inflation data)
export const ETH_RPC_URLS = process.env.ETH_RPC_URLS?.split(',').map(s => s.trim()).filter(Boolean) || [
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
  'https://ethereum.publicnode.com',
];

// POL Emission Manager contract (Ethereum mainnet)
export const POL_EMISSION_MANAGER_PROXY = '0xbC9f74b3b14f460a6c47dCdDFd17411cBc7b6c53' as const;

// Inflation calculation constants
export const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
export const POL_DECIMALS = 18;
export const WEI_PER_POL = 10n ** 18n;
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build 2>&1 | head -20`

Expected: No type errors related to constants

**Step 3: Commit**

```bash
git add src/lib/constants.ts
git commit -m "feat: add Ethereum RPC and POL emission manager constants"
```

---

## Task 3: Create Ethereum RPC Client

**Files:**
- Create: `src/lib/ethRpc.ts`

**Step 1: Create Ethereum RPC client module**

```typescript
import { createPublicClient, http, PublicClient, Log } from 'viem';
import { mainnet } from 'viem/chains';
import { ETH_RPC_URLS } from './constants';
import { sleep } from './utils';

interface RetryConfig {
  maxRetries: number;
  delayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  delayMs: 500,
};

export class EthRpcExhaustedError extends Error {
  constructor(message: string, public lastError?: Error) {
    super(message);
    this.name = 'EthRpcExhaustedError';
  }
}

export class EthRpcClient {
  private urls: string[];
  private clients: PublicClient[];
  private currentIndex = 0;
  private retryConfig: RetryConfig;

  constructor(urls: string[], retryConfig = DEFAULT_RETRY_CONFIG) {
    if (urls.length === 0) {
      throw new Error('At least one Ethereum RPC URL is required');
    }
    this.urls = urls;
    this.retryConfig = retryConfig;
    this.clients = urls.map((url) =>
      createPublicClient({
        chain: mainnet,
        transport: http(url),
      })
    );
  }

  private get client(): PublicClient {
    return this.clients[this.currentIndex];
  }

  private rotateEndpoint(): void {
    this.currentIndex = (this.currentIndex + 1) % this.urls.length;
  }

  async call<T>(fn: (client: PublicClient) => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let retry = 0; retry <= this.retryConfig.maxRetries; retry++) {
      for (let attempt = 0; attempt < this.urls.length; attempt++) {
        try {
          return await fn(this.client);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt === 0 && retry === 0) {
            console.warn(`ETH RPC ${this.urls[this.currentIndex]} failed: ${lastError.message}, rotating...`);
          }
          this.rotateEndpoint();
        }
      }

      if (retry < this.retryConfig.maxRetries) {
        await sleep(this.retryConfig.delayMs);
      }
    }

    throw new EthRpcExhaustedError(
      `All Ethereum RPC endpoints failed after ${this.retryConfig.maxRetries} retries`,
      lastError
    );
  }

  async getBlockNumber(): Promise<bigint> {
    return this.call((client) => client.getBlockNumber());
  }

  async getBlock(blockNumber: bigint) {
    return this.call((client) => client.getBlock({ blockNumber }));
  }

  async readContract<T>(params: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    blockNumber?: bigint;
  }): Promise<T> {
    return this.call((client) =>
      client.readContract(params) as Promise<T>
    );
  }

  async getLogs(params: {
    address: `0x${string}`;
    event: unknown;
    fromBlock: bigint;
    toBlock: bigint | 'latest';
  }): Promise<Log[]> {
    return this.call((client) =>
      client.getLogs(params as Parameters<typeof client.getLogs>[0])
    );
  }
}

let ethRpcClient: EthRpcClient | null = null;

export function getEthRpcClient(): EthRpcClient {
  if (!ethRpcClient) {
    if (ETH_RPC_URLS.length === 0) {
      throw new Error('No Ethereum RPC URLs configured');
    }
    ethRpcClient = new EthRpcClient(ETH_RPC_URLS);
  }
  return ethRpcClient;
}
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build 2>&1 | grep -i error || echo "Build successful"`

Expected: "Build successful" or no error output

**Step 3: Commit**

```bash
git add src/lib/ethRpc.ts
git commit -m "feat: add Ethereum mainnet RPC client"
```

---

## Task 4: Create Inflation Types

**Files:**
- Modify: `src/lib/types.ts`

**Step 1: Add inflation-related types**

Add at the end of `src/lib/types.ts`:

```typescript
// Inflation rate data from database
export interface InflationRate {
  id: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  interestPerYearLog2: bigint;
  startSupply: bigint;
  startTimestamp: bigint;
  implementationAddress: string;
  createdAt: Date;
}

// Inflation rate row from database (raw)
export interface InflationRateRow {
  id: number;
  block_number: string;
  block_timestamp: string;
  interest_per_year_log2: string;
  start_supply: string;
  start_timestamp: string;
  implementation_address: string;
  created_at: string;
}

// API response for inflation rates
export interface InflationRateResponse {
  blockNumber: string;
  blockTimestamp: string;
  interestPerYearLog2: string;
  startSupply: string;
  startTimestamp: string;
  implementationAddress: string;
}

// Inflation chart data point (calculated on frontend)
export interface InflationChartDataPoint {
  timestamp: number;
  issuance: number;         // POL issued in this bucket
  netInflation: number;     // issuance - burned
  totalSupply: number;      // Total supply at bucket end
  supplyAtStart: number;    // Supply at start of time range (for % calc)
}
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build 2>&1 | grep -i error || echo "Build successful"`

Expected: "Build successful"

**Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add inflation rate types"
```

---

## Task 5: Create Inflation Calculation Module with Tests

**Files:**
- Create: `src/lib/inflationCalc.ts`
- Create: `src/lib/__tests__/inflationCalc.test.ts`

**Step 1: Install Jest if not present**

Run: `npm list jest 2>/dev/null || npm install -D jest @types/jest ts-jest`

Expected: Jest available

**Step 2: Create Jest config if not present**

Create `jest.config.js` if it doesn't exist:

```javascript
/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

module.exports = config;
```

**Step 3: Write failing tests first**

Create `src/lib/__tests__/inflationCalc.test.ts`:

```typescript
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
```

**Step 4: Run tests to verify they fail**

Run: `npx jest src/lib/__tests__/inflationCalc.test.ts 2>&1 | head -20`

Expected: Tests fail with "Cannot find module '../inflationCalc'"

**Step 5: Implement the inflation calculation module**

Create `src/lib/inflationCalc.ts`:

```typescript
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
```

**Step 6: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/inflationCalc.test.ts --verbose`

Expected: All tests pass

**Step 7: Commit**

```bash
git add src/lib/inflationCalc.ts src/lib/__tests__/inflationCalc.test.ts jest.config.js
git commit -m "feat: add inflation calculation module with tests"
```

---

## Task 6: Create Inflation Contract Integration

**Files:**
- Create: `src/lib/inflation.ts`

**Step 1: Create the contract integration module**

```typescript
import { parseAbi, Log } from 'viem';
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
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build 2>&1 | grep -i error || echo "Build successful"`

Expected: "Build successful"

**Step 3: Commit**

```bash
git add src/lib/inflation.ts
git commit -m "feat: add POL emission manager contract integration"
```

---

## Task 7: Create Database Queries for Inflation Rates

**Files:**
- Create: `src/lib/queries/inflation.ts`

**Step 1: Create the queries module**

```typescript
import { query, queryOne } from '../db';
import { InflationRate, InflationRateRow } from '../types';

function rowToInflationRate(row: InflationRateRow): InflationRate {
  return {
    id: row.id,
    blockNumber: BigInt(row.block_number),
    blockTimestamp: new Date(row.block_timestamp),
    interestPerYearLog2: BigInt(row.interest_per_year_log2),
    startSupply: BigInt(row.start_supply),
    startTimestamp: BigInt(row.start_timestamp),
    implementationAddress: row.implementation_address,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Get all inflation rates ordered by block timestamp
 */
export async function getAllInflationRates(): Promise<InflationRate[]> {
  const rows = await query<InflationRateRow>(
    `SELECT * FROM inflation_rates ORDER BY block_timestamp ASC`
  );
  return rows.map(rowToInflationRate);
}

/**
 * Get the latest (most recent) inflation rate
 */
export async function getLatestInflationRate(): Promise<InflationRate | null> {
  const row = await queryOne<InflationRateRow>(
    `SELECT * FROM inflation_rates ORDER BY block_timestamp DESC LIMIT 1`
  );
  return row ? rowToInflationRate(row) : null;
}

/**
 * Insert a new inflation rate
 */
export async function insertInflationRate(rate: {
  blockNumber: bigint;
  blockTimestamp: Date;
  interestPerYearLog2: bigint;
  startSupply: bigint;
  startTimestamp: bigint;
  implementationAddress: string;
}): Promise<void> {
  await query(
    `INSERT INTO inflation_rates
      (block_number, block_timestamp, interest_per_year_log2, start_supply, start_timestamp, implementation_address)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (block_number) DO NOTHING`,
    [
      rate.blockNumber.toString(),
      rate.blockTimestamp.toISOString(),
      rate.interestPerYearLog2.toString(),
      rate.startSupply.toString(),
      rate.startTimestamp.toString(),
      rate.implementationAddress,
    ]
  );
}

/**
 * Check if inflation_rates table has any data
 */
export async function hasInflationRates(): Promise<boolean> {
  const result = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM inflation_rates) as exists`
  );
  return result?.exists ?? false;
}

/**
 * Get count of inflation rates
 */
export async function getInflationRateCount(): Promise<number> {
  const result = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM inflation_rates`
  );
  return parseInt(result?.count ?? '0', 10);
}
```

**Step 2: Create queries directory if needed and verify build**

Run: `mkdir -p src/lib/queries && npm run build 2>&1 | grep -i error || echo "Build successful"`

Expected: "Build successful"

**Step 3: Commit**

```bash
git add src/lib/queries/inflation.ts
git commit -m "feat: add inflation rate database queries"
```

---

## Task 8: Create Inflation Backfill Worker

**Files:**
- Create: `src/lib/workers/inflationBackfill.ts`

**Step 1: Create the backfill worker**

```typescript
import { fetchAllInflationRates } from '../inflation';
import {
  hasInflationRates,
  insertInflationRate,
  getInflationRateCount,
} from '../queries/inflation';

let isBackfilling = false;
let lastBackfillError: string | null = null;

/**
 * Run inflation rate backfill if needed
 * This should be called on application startup
 */
export async function runInflationBackfillIfNeeded(): Promise<{
  ran: boolean;
  count: number;
  error?: string;
}> {
  // Check if we already have data
  const hasData = await hasInflationRates();

  if (hasData) {
    const count = await getInflationRateCount();
    console.log(`Inflation backfill skipped: ${count} rates already in database`);
    return { ran: false, count };
  }

  return runInflationBackfill();
}

/**
 * Force run inflation backfill (for manual refresh)
 */
export async function runInflationBackfill(): Promise<{
  ran: boolean;
  count: number;
  error?: string;
}> {
  if (isBackfilling) {
    return { ran: false, count: 0, error: 'Backfill already in progress' };
  }

  isBackfilling = true;
  lastBackfillError = null;

  try {
    console.log('Starting inflation rate backfill from Ethereum mainnet...');

    const rates = await fetchAllInflationRates();
    console.log(`Found ${rates.length} inflation rate changes`);

    for (const rate of rates) {
      await insertInflationRate(rate);
      console.log(`Inserted rate at block ${rate.blockNumber}: ${rate.interestPerYearLog2}`);
    }

    const count = await getInflationRateCount();
    console.log(`Inflation backfill complete: ${count} rates in database`);

    return { ran: true, count };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastBackfillError = message;
    console.error('Inflation backfill failed:', message);
    return { ran: true, count: 0, error: message };
  } finally {
    isBackfilling = false;
  }
}

/**
 * Get backfill status
 */
export function getBackfillStatus(): {
  isBackfilling: boolean;
  lastError: string | null;
} {
  return {
    isBackfilling,
    lastError: lastBackfillError,
  };
}
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build 2>&1 | grep -i error || echo "Build successful"`

Expected: "Build successful"

**Step 3: Commit**

```bash
git add src/lib/workers/inflationBackfill.ts
git commit -m "feat: add inflation rate backfill worker"
```

---

## Task 9: Create API Endpoints

**Files:**
- Create: `src/app/api/inflation-rates/route.ts`
- Create: `src/app/api/inflation/refresh/route.ts`

**Step 1: Create GET /api/inflation-rates endpoint**

Create directory and file:

```typescript
// src/app/api/inflation-rates/route.ts
import { NextResponse } from 'next/server';
import { getAllInflationRates } from '@/lib/queries/inflation';
import { InflationRateResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rates = await getAllInflationRates();

    const response: InflationRateResponse[] = rates.map(rate => ({
      blockNumber: rate.blockNumber.toString(),
      blockTimestamp: rate.blockTimestamp.toISOString(),
      interestPerYearLog2: rate.interestPerYearLog2.toString(),
      startSupply: rate.startSupply.toString(),
      startTimestamp: rate.startTimestamp.toString(),
      implementationAddress: rate.implementationAddress,
    }));

    return NextResponse.json({
      rates: response,
      count: response.length,
    });
  } catch (error) {
    console.error('Failed to fetch inflation rates:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inflation rates' },
      { status: 500 }
    );
  }
}
```

**Step 2: Create POST /api/inflation/refresh endpoint**

```typescript
// src/app/api/inflation/refresh/route.ts
import { NextResponse } from 'next/server';
import { getLatestInflationRate, insertInflationRate } from '@/lib/queries/inflation';
import { readInflationParams } from '@/lib/inflation';
import { getEthRpcClient } from '@/lib/ethRpc';
import { runInflationBackfillIfNeeded } from '@/lib/workers/inflationBackfill';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // First, ensure we have backfilled historical data
    const backfillResult = await runInflationBackfillIfNeeded();

    if (backfillResult.error) {
      return NextResponse.json({
        updated: false,
        error: backfillResult.error,
      });
    }

    // Get latest known rate from DB
    const latestRate = await getLatestInflationRate();

    // Read current on-chain values
    const currentParams = await readInflationParams();
    const client = getEthRpcClient();
    const currentBlockNumber = await client.getBlockNumber();
    const currentBlock = await client.getBlock(currentBlockNumber);

    // Check if rate has changed
    if (latestRate && latestRate.interestPerYearLog2 === currentParams.interestPerYearLog2) {
      return NextResponse.json({
        updated: false,
        currentRate: currentParams.interestPerYearLog2.toString(),
        lastChange: latestRate.blockTimestamp.toISOString(),
        message: 'No change in inflation rate',
      });
    }

    // Rate has changed (or this is first check) - insert new record
    await insertInflationRate({
      blockNumber: currentBlockNumber,
      blockTimestamp: new Date(Number(currentBlock.timestamp) * 1000),
      interestPerYearLog2: currentParams.interestPerYearLog2,
      startSupply: currentParams.startSupply,
      startTimestamp: currentParams.startTimestamp,
      implementationAddress: 'manual-refresh',
    });

    return NextResponse.json({
      updated: true,
      currentRate: currentParams.interestPerYearLog2.toString(),
      lastChange: new Date(Number(currentBlock.timestamp) * 1000).toISOString(),
      message: 'Inflation rate updated',
    });
  } catch (error) {
    console.error('Failed to refresh inflation rate:', error);
    return NextResponse.json(
      { error: 'Failed to refresh inflation rate', details: String(error) },
      { status: 500 }
    );
  }
}
```

**Step 3: Create directories and verify build**

Run: `mkdir -p src/app/api/inflation-rates src/app/api/inflation/refresh && npm run build 2>&1 | grep -i error || echo "Build successful"`

Expected: "Build successful"

**Step 4: Commit**

```bash
git add src/app/api/inflation-rates/route.ts src/app/api/inflation/refresh/route.ts
git commit -m "feat: add inflation rate API endpoints"
```

---

## Task 10: Create Inflation Chart Component

**Files:**
- Create: `src/components/charts/InflationChart.tsx`

**Step 1: Create the chart component**

```typescript
'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineData,
  UTCTimestamp,
  LineSeries,
  SeriesType,
} from 'lightweight-charts';
import { useTheme } from '../ThemeProvider';
import { ChartControls } from './ChartControls';
import { InflationRateResponse } from '@/lib/types';
import {
  prepareRatesForCalculation,
  calculateSupplyAt,
  calculateBucketIssuance,
  weiToPol,
  annualize,
  InflationRateParams,
} from '@/lib/inflationCalc';
import {
  CHART_COLOR_PALETTE,
  TIME_RANGE_BUCKETS,
  TIME_RANGE_SECONDS,
  GWEI_PER_POL,
} from '@/lib/constants';
import { formatPol } from '@/lib/utils';

type InflationMetric = 'issuance' | 'netInflation' | 'totalSupply';

interface InflationChartProps {
  title: string;
  metric: InflationMetric;
}

interface ChartDataPoint {
  timestamp: number;
  bucketStart: number;
  bucketEnd: number;
  issuance: number;
  burned: number;
  netInflation: number;
  totalSupply: number;
  supplyAtRangeStart: number;
}

function getRecommendedBucket(range: string): string {
  return TIME_RANGE_BUCKETS[range] ?? '1h';
}

function formatDateTimeLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function bucketSizeToSeconds(bucket: string): number {
  const match = bucket.match(/^(\d+)(s|m|h|d|w)$/);
  if (!match) return 3600;
  const [, num, unit] = match;
  const n = parseInt(num, 10);
  switch (unit) {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    case 'w': return n * 604800;
    default: return 3600;
  }
}

export function InflationChart({ title, metric }: InflationChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map());
  const { theme } = useTheme();

  const [timeRange, setTimeRange] = useState('1D');
  const [bucketSize, setBucketSize] = useState('15m');
  const [showAsPercent, setShowAsPercent] = useState(false);
  const [rates, setRates] = useState<InflationRateParams[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [burnData, setBurnData] = useState<Map<number, number>>(new Map());
  const [isZoomed, setIsZoomed] = useState(false);
  const timeRangeRef = useRef(timeRange);

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [customStartTime, setCustomStartTime] = useState(formatDateTimeLocal(oneHourAgo));
  const [customEndTime, setCustomEndTime] = useState(formatDateTimeLocal(now));
  const [appliedCustomRange, setAppliedCustomRange] = useState<{ start: number; end: number } | null>(null);

  const handleTimeRangeChange = (range: string) => {
    setTimeRange(range);
    if (range !== 'Custom') {
      setBucketSize(getRecommendedBucket(range));
      setAppliedCustomRange(null);
    }
    timeRangeRef.current = range;
  };

  const handleApplyCustomRange = () => {
    const start = Math.floor(new Date(customStartTime).getTime() / 1000);
    const end = Math.floor(new Date(customEndTime).getTime() / 1000);
    if (start < end) {
      setAppliedCustomRange({ start, end });
    }
  };

  // Fetch inflation rates (once)
  useEffect(() => {
    async function fetchRates() {
      try {
        const response = await fetch('/api/inflation-rates');
        const json = await response.json();
        if (json.rates) {
          const prepared = prepareRatesForCalculation(json.rates);
          setRates(prepared);
        }
      } catch (error) {
        console.error('Failed to fetch inflation rates:', error);
      }
    }
    fetchRates();
  }, []);

  // Fetch burn data from existing chart-data API
  const fetchBurnData = useCallback(async () => {
    let fromTime: number;
    let toTime: number;

    if (timeRange === 'Custom' && appliedCustomRange) {
      fromTime = appliedCustomRange.start;
      toTime = appliedCustomRange.end;
    } else {
      toTime = Math.floor(Date.now() / 1000);
      const rangeSeconds = TIME_RANGE_SECONDS[timeRange] ?? 0;
      fromTime = rangeSeconds > 0 ? toTime - rangeSeconds : 0;
    }

    try {
      const response = await fetch(
        `/api/chart-data?fromTime=${fromTime}&toTime=${toTime}&bucketSize=${bucketSize}&limit=5000`
      );
      const json = await response.json();

      const burnMap = new Map<number, number>();
      if (json.data) {
        for (const d of json.data) {
          // totalBaseFeeSum is in gwei, convert to POL
          burnMap.set(d.timestamp, d.totalBaseFeeSum / GWEI_PER_POL);
        }
      }
      setBurnData(burnMap);
    } catch (error) {
      console.error('Failed to fetch burn data:', error);
    }
  }, [timeRange, bucketSize, appliedCustomRange]);

  useEffect(() => {
    fetchBurnData();
  }, [fetchBurnData]);

  // Calculate chart data when rates or burn data change
  useEffect(() => {
    if (rates.length === 0) return;

    let fromTime: number;
    let toTime: number;

    if (timeRange === 'Custom' && appliedCustomRange) {
      fromTime = appliedCustomRange.start;
      toTime = appliedCustomRange.end;
    } else {
      toTime = Math.floor(Date.now() / 1000);
      const rangeSeconds = TIME_RANGE_SECONDS[timeRange] ?? 0;
      fromTime = rangeSeconds > 0 ? toTime - rangeSeconds : 0;
    }

    const bucketSeconds = bucketSizeToSeconds(bucketSize);
    const supplyAtRangeStart = weiToPol(calculateSupplyAt(fromTime, rates[rates.length - 1]));

    const data: ChartDataPoint[] = [];

    for (let t = fromTime; t < toTime; t += bucketSeconds) {
      const bucketEnd = Math.min(t + bucketSeconds, toTime);
      const issuanceWei = calculateBucketIssuance(t, bucketEnd, rates);
      const issuancePol = weiToPol(issuanceWei);
      const burned = burnData.get(t) || 0;
      const totalSupply = weiToPol(calculateSupplyAt(bucketEnd, rates[rates.length - 1]));

      data.push({
        timestamp: t,
        bucketStart: t,
        bucketEnd,
        issuance: issuancePol,
        burned,
        netInflation: issuancePol - burned,
        totalSupply,
        supplyAtRangeStart,
      });
    }

    setChartData(data);
  }, [rates, burnData, timeRange, bucketSize, appliedCustomRange]);

  // Series options based on metric
  const seriesOptions = useMemo(() => {
    const colors = CHART_COLOR_PALETTE;
    if (metric === 'netInflation') {
      return [
        { key: 'netInflation', label: 'Net Inflation', enabled: true, color: colors[0] },
        { key: 'issuance', label: 'Issuance', enabled: false, color: colors[1] },
        { key: 'burned', label: 'Burned', enabled: false, color: colors[4] },
      ];
    }
    if (metric === 'issuance') {
      return [
        { key: 'issuance', label: 'Issuance', enabled: true, color: colors[1] },
      ];
    }
    return [
      { key: 'totalSupply', label: 'Total Supply', enabled: true, color: colors[2] },
    ];
  }, [metric]);

  const [enabledSeries, setEnabledSeries] = useState(seriesOptions);

  useEffect(() => {
    setEnabledSeries(seriesOptions);
  }, [seriesOptions]);

  const handleSeriesToggle = (key: string) => {
    setEnabledSeries((prev) =>
      prev.map((opt) => (opt.key === key ? { ...opt, enabled: !opt.enabled } : opt))
    );
  };

  const shouldShowDates = (range: string): boolean => {
    if (range === 'Custom' && appliedCustomRange) {
      return (appliedCustomRange.end - appliedCustomRange.start) > 86400;
    }
    const longRanges = ['1D', '1W', '1M', '6M', '1Y', 'ALL'];
    return longRanges.includes(range);
  };

  const formatTimeLabel = (time: number): string => {
    const date = new Date(time * 1000);
    if (shouldShowDates(timeRangeRef.current)) {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Create chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 300,
      layout: {
        background: { color: 'transparent' },
        textColor: theme === 'dark' ? '#d1d5db' : '#374151',
      },
      grid: {
        vertLines: { color: theme === 'dark' ? '#374151' : '#e5e7eb' },
        horzLines: { color: theme === 'dark' ? '#374151' : '#e5e7eb' },
      },
      rightPriceScale: { visible: true, borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        tickMarkFormatter: (time: number) => formatTimeLabel(time),
      },
    });

    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => setIsZoomed(true));
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update theme
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        layout: { textColor: theme === 'dark' ? '#d1d5db' : '#374151' },
        grid: {
          vertLines: { color: theme === 'dark' ? '#374151' : '#e5e7eb' },
          horzLines: { color: theme === 'dark' ? '#374151' : '#e5e7eb' },
        },
      });
    }
  }, [theme]);

  // Update series data
  useEffect(() => {
    if (!chartRef.current || chartData.length === 0) return;

    seriesRefs.current.forEach((series) => chartRef.current?.removeSeries(series));
    seriesRefs.current.clear();

    enabledSeries
      .filter((opt) => opt.enabled)
      .forEach((opt) => {
        let seriesData: LineData<UTCTimestamp>[];

        if (opt.key === 'totalSupply') {
          seriesData = chartData.map((d) => ({
            time: d.timestamp as UTCTimestamp,
            value: showAsPercent ? 100 : d.totalSupply,
          }));
        } else {
          seriesData = chartData.map((d) => {
            let rawValue = opt.key === 'issuance' ? d.issuance :
                          opt.key === 'burned' ? d.burned :
                          d.netInflation;

            if (showAsPercent && d.supplyAtRangeStart > 0) {
              rawValue = (rawValue / d.supplyAtRangeStart) * 100;
            }

            return { time: d.timestamp as UTCTimestamp, value: rawValue };
          });
        }

        const series = chartRef.current!.addSeries(LineSeries, {
          color: opt.color,
          lineWidth: 2,
          priceScaleId: 'right',
        });

        series.setData(seriesData);
        seriesRefs.current.set(opt.key, series);
      });

    chartRef.current.timeScale().fitContent();
  }, [chartData, enabledSeries, showAsPercent]);

  const handleResetZoom = () => {
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
      setIsZoomed(false);
    }
  };

  // Calculate period totals
  const periodTotals = useMemo(() => {
    if (chartData.length === 0) return null;

    const totalIssuance = chartData.reduce((sum, d) => sum + d.issuance, 0);
    const totalBurned = chartData.reduce((sum, d) => sum + d.burned, 0);
    const netInflation = totalIssuance - totalBurned;
    const supplyAtStart = chartData[0]?.supplyAtRangeStart || 0;
    const periodSeconds = chartData.length > 0
      ? (chartData[chartData.length - 1].bucketEnd - chartData[0].bucketStart)
      : 1;

    return {
      totalIssuance,
      totalBurned,
      netInflation,
      supplyAtStart,
      periodSeconds,
      issuancePercent: supplyAtStart > 0 ? (totalIssuance / supplyAtStart) * 100 : 0,
      netInflationPercent: supplyAtStart > 0 ? (netInflation / supplyAtStart) * 100 : 0,
      annualizedIssuance: annualize(totalIssuance, periodSeconds),
      annualizedNetInflation: annualize(netInflation, periodSeconds),
      annualizedIssuancePercent: supplyAtStart > 0 ? annualize((totalIssuance / supplyAtStart) * 100, periodSeconds) : 0,
      annualizedNetInflationPercent: supplyAtStart > 0 ? annualize((netInflation / supplyAtStart) * 100, periodSeconds) : 0,
    };
  }, [chartData]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-4">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold">{title}</h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showAsPercent}
              onChange={(e) => setShowAsPercent(e.target.checked)}
              className="rounded"
            />
            Show as %
          </label>
          {isZoomed && (
            <button
              onClick={handleResetZoom}
              className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded"
            >
              Reset Zoom
            </button>
          )}
        </div>
      </div>

      {periodTotals && metric !== 'totalSupply' && (
        <div className="mb-4 text-sm grid grid-cols-2 gap-2">
          <div>
            <span className="text-gray-500 dark:text-gray-400">Period: </span>
            <span className="font-semibold">
              {showAsPercent
                ? `${periodTotals[metric === 'issuance' ? 'issuancePercent' : 'netInflationPercent'].toFixed(4)}%`
                : `${formatPol(periodTotals[metric === 'issuance' ? 'totalIssuance' : 'netInflation'])} POL`
              }
            </span>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Annualized: </span>
            <span className="font-semibold">
              {showAsPercent
                ? `${periodTotals[metric === 'issuance' ? 'annualizedIssuancePercent' : 'annualizedNetInflationPercent'].toFixed(2)}%/yr`
                : `${formatPol(periodTotals[metric === 'issuance' ? 'annualizedIssuance' : 'annualizedNetInflation'])} POL/yr`
              }
            </span>
          </div>
        </div>
      )}

      <ChartControls
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        bucketSize={bucketSize}
        onBucketSizeChange={setBucketSize}
        seriesOptions={enabledSeries}
        onSeriesToggle={handleSeriesToggle}
        customStartTime={customStartTime}
        customEndTime={customEndTime}
        onCustomStartTimeChange={setCustomStartTime}
        onCustomEndTimeChange={setCustomEndTime}
        onApplyCustomRange={handleApplyCustomRange}
      />

      <div className="relative mt-4">
        <div ref={chartContainerRef} className="w-full" />
      </div>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build 2>&1 | grep -i error || echo "Build successful"`

Expected: "Build successful"

**Step 3: Commit**

```bash
git add src/components/charts/InflationChart.tsx
git commit -m "feat: add inflation chart component"
```

---

## Task 11: Update Analytics Page

**Files:**
- Modify: `src/app/analytics/page.tsx`

**Step 1: Add inflation charts to analytics page**

Update `src/app/analytics/page.tsx`:

```typescript
'use client';

import { Nav } from '@/components/Nav';
import { FullChart } from '@/components/charts/FullChart';
import { CustomizableChart } from '@/components/charts/CustomizableChart';
import { InflationChart } from '@/components/charts/InflationChart';

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen">
      <Nav />

      <main className="w-full px-4 py-6">
        {/* Customizable charts at the top */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <CustomizableChart
            title="Compare (Dual Axis)"
            defaultLeftSeries="baseFee"
            defaultRightSeries="blockLimit"
            dualAxis={true}
          />
          <CustomizableChart
            title="Compare (Same Axis)"
            defaultLeftSeries="cumulativeBaseFee"
            defaultRightSeries="cumulativePriorityFee"
            dualAxis={false}
          />
        </div>

        {/* Block Time Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <FullChart title="Bor Block Time (seconds)" metric="borBlockTime" />
          <FullChart title="Milestone Time (seconds)" metric="heimdallBlockTime" />
        </div>

        {/* Inflation Charts - NEW */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <InflationChart title="POL Issuance" metric="issuance" />
          <InflationChart title="Net Inflation (Issuance - Burned)" metric="netInflation" />
        </div>

        {/* Standard charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <FullChart title="Gas Price (gwei)" metric="gas" />
          <FullChart title="Finality Time (seconds)" metric="finality" />
          <FullChart title="MGAS/s" metric="mgas" />
          <FullChart title="TPS" metric="tps" />
          <FullChart title="Block Limit (M gas)" metric="blockLimit" />
          <FullChart title="Block Utilization (%)" metric="blockLimitUtilization" />
          <FullChart title="Total Base Fee per Block (POL)" metric="totalBaseFee" />
          <FullChart title="Total Priority Fee per Block (POL)" metric="totalPriorityFee" />
          <FullChart title="Total Fee per Block (POL)" metric="totalFee" />
          <FullChart title="Cumulative Base Fee per Block (POL)" metric="totalBaseFee" showCumulative />
          <FullChart title="Cumulative Priority Fee per Block (POL)" metric="totalPriorityFee" showCumulative />
          <FullChart title="Cumulative Total Fee per Block (POL)" metric="totalFee" showCumulative />
        </div>

        {/* Total Supply Chart - NEW */}
        <div className="mb-6">
          <InflationChart title="Total POL Supply" metric="totalSupply" />
        </div>
      </main>
    </div>
  );
}
```

**Step 2: Verify build**

Run: `npm run build 2>&1 | grep -i error || echo "Build successful"`

Expected: "Build successful"

**Step 3: Commit**

```bash
git add src/app/analytics/page.tsx
git commit -m "feat: add inflation charts to analytics page"
```

---

## Task 12: Add Inflation Card to Status Page

**Files:**
- Modify: `src/app/status/page.tsx`

**Step 1: Add inflation status card and refresh button**

Add to the status page (near the top of the page, after the overview cards):

Find the existing card structure and add a new Inflation card. Add this interface to the StatusData type:

```typescript
// Add to StatusData interface
inflation?: {
  rateCount: number;
  latestRate: string | null;
  lastChange: string | null;
};
```

Add this card component inside the page (after the overview cards):

```typescript
{/* Inflation Rate Card */}
<div className="bg-white dark:bg-gray-900 rounded-lg shadow p-4">
  <h3 className="text-lg font-semibold mb-4">POL Inflation Rate</h3>
  <div className="space-y-2 text-sm">
    <div className="flex justify-between">
      <span className="text-gray-500 dark:text-gray-400">Stored Rates:</span>
      <span className="font-medium">{status?.inflation?.rateCount ?? 'N/A'}</span>
    </div>
    <div className="flex justify-between">
      <span className="text-gray-500 dark:text-gray-400">Last Change:</span>
      <span className="font-medium">
        {status?.inflation?.lastChange
          ? formatTimeAgo(status.inflation.lastChange)
          : 'Never'}
      </span>
    </div>
  </div>
  <button
    onClick={handleRefreshInflation}
    disabled={isRefreshingInflation}
    className="mt-4 w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
  >
    {isRefreshingInflation ? 'Checking...' : 'Check for New Rate'}
  </button>
  {inflationRefreshResult && (
    <div className={`mt-2 text-sm ${inflationRefreshResult.updated ? 'text-green-600' : 'text-gray-500'}`}>
      {inflationRefreshResult.message}
    </div>
  )}
</div>
```

Add these state variables and handler:

```typescript
const [isRefreshingInflation, setIsRefreshingInflation] = useState(false);
const [inflationRefreshResult, setInflationRefreshResult] = useState<{
  updated: boolean;
  message: string;
} | null>(null);

const handleRefreshInflation = async () => {
  setIsRefreshingInflation(true);
  setInflationRefreshResult(null);
  try {
    const response = await fetch('/api/inflation/refresh', { method: 'POST' });
    const result = await response.json();
    setInflationRefreshResult({
      updated: result.updated,
      message: result.message || (result.updated ? 'Rate updated!' : 'No change'),
    });
    // Refresh status after update
    if (result.updated) {
      fetchStatus();
    }
  } catch (error) {
    setInflationRefreshResult({
      updated: false,
      message: 'Failed to check inflation rate',
    });
  } finally {
    setIsRefreshingInflation(false);
  }
};
```

**Step 2: Update /api/status to include inflation data**

Add to `/api/status/route.ts`:

```typescript
import { getInflationRateCount, getLatestInflationRate } from '@/lib/queries/inflation';

// Inside the GET handler, add:
const [inflationCount, latestInflation] = await Promise.all([
  getInflationRateCount().catch(() => 0),
  getLatestInflationRate().catch(() => null),
]);

// Add to response object:
inflation: {
  rateCount: inflationCount,
  latestRate: latestInflation?.interestPerYearLog2.toString() ?? null,
  lastChange: latestInflation?.blockTimestamp.toISOString() ?? null,
},
```

**Step 3: Verify build**

Run: `npm run build 2>&1 | grep -i error || echo "Build successful"`

Expected: "Build successful"

**Step 4: Commit**

```bash
git add src/app/status/page.tsx src/app/api/status/route.ts
git commit -m "feat: add inflation rate card to status page"
```

---

## Task 13: Add Integration Tests for On-Chain Values

**Files:**
- Create: `src/lib/__tests__/inflation.integration.test.ts`

**Step 1: Create integration test that verifies against on-chain data**

```typescript
import { calculateSupplyAt, exp2 } from '../inflationCalc';
import { readInflationParams } from '../inflation';
import { getEthRpcClient } from '../ethRpc';
import { POL_EMISSION_MANAGER_PROXY, WEI_PER_POL } from '../constants';
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
```

**Step 2: Run unit tests (integration tests skipped without RPC)**

Run: `npx jest src/lib/__tests__/inflationCalc.test.ts --verbose`

Expected: All unit tests pass

**Step 3: Commit**

```bash
git add src/lib/__tests__/inflation.integration.test.ts
git commit -m "test: add integration tests for on-chain inflation values"
```

---

## Task 14: Final Verification

**Step 1: Run full build**

Run: `npm run build`

Expected: Build completes without errors

**Step 2: Run all tests**

Run: `npx jest --verbose`

Expected: All tests pass

**Step 3: Test locally (manual)**

Run: `npm run dev`

Then verify:
1. Visit `/analytics` - see new inflation charts
2. Visit `/status` - see inflation card with refresh button
3. Click refresh button - should fetch/backfill rates

**Step 4: Create final commit with all changes**

```bash
git add -A
git status
# If any uncommitted changes:
git commit -m "feat: complete POL inflation tracking implementation"
```

---

## Summary

This implementation adds:

1. **Database**: `inflation_rates` table storing rate changes
2. **Backend**: Ethereum RPC client, contract integration, backfill worker
3. **API**: `/api/inflation-rates` (GET) and `/api/inflation/refresh` (POST)
4. **Frontend**: `InflationChart` component with raw/% toggle and annualized values
5. **UI**: Analytics page with issuance, net inflation, and supply charts
6. **Status**: Inflation card with manual refresh button
7. **Tests**: Unit tests for calculations, integration tests against on-chain values

The frontend calculates all values locally using the stored inflation rate parameters, minimizing API calls and enabling real-time updates.
