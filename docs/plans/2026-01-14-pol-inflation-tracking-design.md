# POL Inflation & Issuance Tracking Design

## Overview

Add graphs for POL issuance, net inflation (issuance - base fee burned), and total supply to the analytics page. Fetch inflation rate from Ethereum mainnet POL emission manager contract, store rate changes in DB, and calculate values on the frontend.

## Requirements

- **Issuance**: Theoretical inflation calculated from contract formula
- **Net Inflation**: Issuance minus base fee burned (can be negative/deflationary)
- **Total Supply**: Calculated from formula at any point in time
- **Display modes**: Raw POL, % of supply at period start, annualized versions of both
- **Time ranges**: Same as existing charts (5m to ALL)
- **Inflation rate storage**: Only store when rate changes (1-2x per year)
- **Backfill**: Query Upgraded events from proxy contract to find historical changes

## Data Source

**Contract**: POL Emission Manager Proxy
**Address**: `0xbC9f74b3b14f460a6c47dCdDFd17411cBc7b6c53` (Ethereum mainnet)

**Formula**:
```solidity
function inflatedSupplyAfter(uint256 timeElapsed) public view returns (uint256 supply) {
    uint256 supplyFactor = PowUtil.exp2((INTEREST_PER_YEAR_LOG2 * timeElapsed) / 365 days);
    supply = (supplyFactor * START_SUPPLY) / 1e18;
}
```

**Key parameters** (updated on each contract upgrade):
- `INTEREST_PER_YEAR_LOG2` - Log2 of annual interest rate
- `START_SUPPLY` - Supply at the start of current rate period
- `START_TIMESTAMP` - Reference timestamp for timeElapsed calculation

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS inflation_rates (
  id SERIAL PRIMARY KEY,
  block_number BIGINT NOT NULL UNIQUE,
  block_timestamp TIMESTAMPTZ NOT NULL,
  interest_per_year_log2 NUMERIC(78, 0) NOT NULL,  -- uint256 from contract
  start_supply NUMERIC(78, 0) NOT NULL,            -- uint256, wei
  start_timestamp BIGINT NOT NULL,                 -- unix timestamp from contract
  implementation_address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inflation_rates_timestamp
  ON inflation_rates(block_timestamp);
```

## Configuration

```typescript
// src/lib/constants.ts
export const ETH_RPC_URLS = process.env.ETH_RPC_URLS?.split(',') || [
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
  'https://ethereum.publicnode.com',
];

export const POL_EMISSION_MANAGER_PROXY = '0xbC9f74b3b14f460a6c47dCdDFd17411cBc7b6c53';
```

## Backfill Strategy

1. Query all `Upgraded(address implementation)` events from proxy contract
2. For each upgrade event:
   - Read `INTEREST_PER_YEAR_LOG2`, `START_SUPPLY`, `getStartTimestamp()` at that block
   - Insert into `inflation_rates` table
3. Runs once on startup if table is empty

## Frontend Calculation Logic

**API provides**: All `inflation_rates` rows (small payload, cached)

**Frontend calculates per bucket**:

```typescript
function calculateBucketIssuance(bucketStart, bucketEnd, rates) {
  const activeRate = findRateAt(bucketStart, rates);
  const nextChange = getNextChangeTime(activeRate, rates);

  // Fast path: no rate change in this bucket (99.9% of cases)
  if (nextChange > bucketEnd) {
    return calculateSupplyAt(bucketEnd, activeRate) -
           calculateSupplyAt(bucketStart, activeRate);
  }

  // Slow path: rate change mid-bucket (rare)
  return calculateInflationWithSplits(bucketStart, bucketEnd, rates);
}
```

**Display values**:

| Toggle | Values shown |
|--------|--------------|
| Raw | `+1,234 POL` and `+15.2M POL/year` (annualized) |
| % | `+0.0012%` and `+2.1%/year` (annualized) |

**Net inflation**: `issuance - baseFeesBurned` (from existing aggregates)

## UI Layout

**Analytics page**:

```
Row 1: [Gas Price Chart] [Finality Chart]
Row 2: [MGAS/s Chart] [TPS Chart]
Row 3: [Issuance Chart] [Net Inflation Chart]   <-- NEW
Row 4: [Block Time Charts...]
...
Bottom: [Total Supply Chart]                     <-- NEW
```

**Chart features**:
- Checkbox toggle: "Show as %" (raw POL vs % of supply)
- Tooltip shows current value + annualized value
- Net Inflation shows negative values in different color when deflationary
- Same time range selector as existing charts

**Status page**:
- New "Inflation" card with current rate info
- "Check Inflation Rate" button to manually fetch and update if changed

## API Endpoints

**GET `/api/inflation-rates`**
- Returns all inflation_rates rows for frontend calculation
- Cacheable, rarely changes

**POST `/api/inflation/refresh`**
- Manually check for new inflation rate
- Compares on-chain values to latest DB row
- Inserts new row if changed
- Returns: `{ updated: boolean, currentRate: string, lastChange: string }`

## Files to Create/Modify

| File | Purpose |
|------|---------|
| `docker/migrations/YYYYMMDD_inflation_rates.sql` | New table |
| `src/lib/constants.ts` | Add ETH_RPC_URLS, contract address |
| `src/lib/ethRpc.ts` | Ethereum mainnet client |
| `src/lib/inflation.ts` | Contract reading, event fetching |
| `src/lib/inflationCalc.ts` | Supply/issuance formula (shared) |
| `src/lib/workers/inflationBackfill.ts` | One-time backfill on startup |
| `src/lib/queries/inflation.ts` | DB queries for inflation_rates |
| `src/app/api/inflation-rates/route.ts` | GET rates for frontend |
| `src/app/api/inflation/refresh/route.ts` | POST manual refresh |
| `src/components/charts/InflationChart.tsx` | New chart component |
| `src/app/analytics/page.tsx` | Add row 3 + bottom charts |
| `src/app/status/page.tsx` | Add inflation card with refresh button |
| `src/lib/__tests__/inflation.test.ts` | Test cases |

## Implementation Order

1. Database migration + constants
2. Ethereum RPC client
3. Contract integration + formula implementation
4. Tests (verify formula accuracy)
5. Backfill worker + DB queries
6. API endpoints
7. Chart component + analytics page updates
8. Status page button

## Testing Strategy

1. **Formula accuracy tests** - Compare `calculateSupplyAt()` against on-chain `inflatedSupplyAfter()` calls
2. **exp2 implementation tests** - Verify fixed-point math matches `PowUtil.exp2`
3. **Bucket calculation tests** - Simple buckets and buckets spanning rate changes
4. **Historical validation** - Use real on-chain upgrade transactions to verify backfill accuracy
