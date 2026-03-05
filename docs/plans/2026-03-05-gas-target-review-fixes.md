# Gas Target Percentage - Review Fixes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all issues found in code review of the gas target percentage feature.

**Architecture:** Fix BFCD lookup semantics, harden carry-forward across batch boundaries, add periodic param reload, harden admin API validation, fix chart null handling, and add comprehensive unit tests.

**Tech Stack:** TypeScript, Jest, Next.js API routes, TimescaleDB SQL

---

### Task 1: Fix BFCD Lookup — Use Current Block Number

The BFCD is applied by the validator producing block N, so the lookup should use block N's number, not N-1.

**Files:**
- Modify: `src/lib/indexers/blockIndexer.ts:309-310`
- Modify: `src/lib/indexers/blockBackfiller.ts:284-286,293-295`

**Step 1: Fix blockIndexer.ts**

Change line 309-310 from:
```typescript
const parentBlockNumber = block.number - 1n;
const bfcd = getBfcdForBlock(parentBlockNumber, this.eip1559Params);
```
to:
```typescript
const bfcd = getBfcdForBlock(block.number, this.eip1559Params);
```

(Also remove the now-unused `parentBlockNumber` variable.)

**Step 2: Fix blockBackfiller.ts — in-batch blocks (line 286)**

Change from:
```typescript
const bfcd = getBfcdForBlock(parent.number, this.eip1559Params);
```
to:
```typescript
const bfcd = getBfcdForBlock(block.number, this.eip1559Params);
```

**Step 3: Fix blockBackfiller.ts — extraBlock case (line 295)**

Change from:
```typescript
const bfcd = getBfcdForBlock(extraBlock.number, this.eip1559Params);
```
to:
```typescript
const bfcd = getBfcdForBlock(block.number, this.eip1559Params);
```

---

### Task 2: Fix Carry-Forward Across Batch Boundaries

Two issues:
1. Backfiller's `lastGasTargetPct` is local to `convertBlocks()` — resets each batch.
2. BlockIndexer fetches prevBlock on startup but doesn't seed `this.lastGasTargetPct` from it.

**Files:**
- Modify: `src/lib/indexers/blockBackfiller.ts` — promote `lastGasTargetPct` to class field
- Modify: `src/lib/indexers/blockIndexer.ts:286-292` — seed `lastGasTargetPct` from prevBlock

**Step 1: Backfiller — add class field**

Add `private lastGasTargetPct: number | null = null;` alongside the other class fields (after `private eip1559Params`).

**Step 2: Backfiller — use class field in convertBlocks**

In `convertBlocks()`, change line 265 from:
```typescript
let lastGasTargetPct: number | null = null;
```
to using `this.lastGasTargetPct` everywhere in the method. Replace all occurrences of the local `lastGasTargetPct` with `this.lastGasTargetPct`.

**Step 3: BlockIndexer — seed lastGasTargetPct from prevBlock**

In `convertBlocks()`, after line 291 (`parentGasLimit = prevBlock.gasLimit;`), add:
```typescript
if (prevBlock.gasTargetPct !== null) {
  this.lastGasTargetPct = prevBlock.gasTargetPct;
}
```

---

### Task 3: Add Periodic EIP-1559 Param Reload

Params are loaded once at startup. Admin changes won't be picked up until restart.

**Files:**
- Modify: `src/lib/indexers/blockIndexer.ts` — add reload timer
- Modify: `src/lib/indexers/blockBackfiller.ts` — add reload timer

**Step 1: BlockIndexer — add periodic reload**

Add a class field: `private lastParamReload: number = 0;`

Add a constant at module level: `const PARAM_RELOAD_INTERVAL_MS = 60 * 60 * 1000; // 1 hour`

In `runLoop()`, at the top of the while loop body (before fetching chain tip), add:
```typescript
if (Date.now() - this.lastParamReload > PARAM_RELOAD_INTERVAL_MS) {
  await this.loadEip1559Params();
  this.lastParamReload = Date.now();
}
```

Also set `this.lastParamReload = Date.now();` at the end of `loadEip1559Params()`.

**Step 2: BlockBackfiller — same pattern**

Add same `lastParamReload` field, constant, and reload check in `runLoop()` body.
Set `this.lastParamReload = Date.now();` at the end of `loadEip1559Params()`.

---

### Task 4: Harden Admin API Validation

Issues: BigInt can throw → 500, parseInt accepts "64abc", duplicate is silently swallowed.

**Files:**
- Modify: `src/app/api/admin/eip1559-params/route.ts`

**Step 1: Replace the POST handler body**

Replace the current validation + insert logic with:
```typescript
export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookies();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { blockNumber, baseFeeChangeDenominator, description } = body;

    if (!blockNumber || !baseFeeChangeDenominator) {
      return NextResponse.json(
        { error: 'blockNumber and baseFeeChangeDenominator are required' },
        { status: 400 }
      );
    }

    // Validate blockNumber is a valid integer string
    if (!/^\d+$/.test(String(blockNumber))) {
      return NextResponse.json(
        { error: 'blockNumber must be a non-negative integer' },
        { status: 400 }
      );
    }

    // Validate baseFeeChangeDenominator is a strict positive integer
    const bfcdStr = String(baseFeeChangeDenominator);
    if (!/^\d+$/.test(bfcdStr) || Number(bfcdStr) <= 0) {
      return NextResponse.json(
        { error: 'baseFeeChangeDenominator must be a positive integer' },
        { status: 400 }
      );
    }

    const blockNum = BigInt(blockNumber);
    const bfcd = Number(bfcdStr);

    // Check for duplicate
    const existing = await getAllEip1559Params();
    const isDuplicate = existing.some(p => p.blockNumber === blockNum);
    if (isDuplicate) {
      return NextResponse.json(
        { error: 'A parameter already exists for this block number', duplicate: true },
        { status: 409 }
      );
    }

    await insertEip1559Param({
      blockNumber: blockNum,
      baseFeeChangeDenominator: bfcd,
      description: description || undefined,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('EIP-1559 params POST error:', error);
    return NextResponse.json({ error: 'Failed to add param' }, { status: 500 });
  }
}
```

Key changes:
- Regex validation before BigInt to prevent SyntaxError → 500
- Strict integer check for BFCD (no "64abc")
- Explicit 409 on duplicate with `duplicate: true` flag

---

### Task 5: Fix Chart Null Handling

Two issues:
1. Rollup denominator includes buckets where `gas_target_pct_avg` is null (biasing averages low)
2. Chart hardcodes `?? 65` fallback — wrong for pre-Dandeli blocks

**Files:**
- Modify: `src/lib/queries/charts.ts:279` — fix rollup denominator
- Modify: `src/components/charts/FullChart.tsx:425-429` — filter nulls instead of defaulting

**Step 1: Fix rollup query denominator**

In `charts.ts`, change line 279 from:
```sql
SUM(gas_target_pct_avg * block_count) / NULLIF(SUM(block_count), 0) AS gas_target_pct_avg
```
to:
```sql
SUM(gas_target_pct_avg * block_count) / NULLIF(SUM(CASE WHEN gas_target_pct_avg IS NOT NULL THEN block_count END), 0) AS gas_target_pct_avg
```

This only counts blocks where `gas_target_pct_avg` is not null in the denominator.

**Step 2: Fix chart fallback — filter nulls**

In `FullChart.tsx`, change the gasTarget block from:
```typescript
} else if (metric === 'gasTarget') {
  seriesData = blockData.map((d) => ({
    time: d.timestamp as UTCTimestamp,
    value: d.gasTargetPctAvg ?? 65,
  }));
```
to:
```typescript
} else if (metric === 'gasTarget') {
  seriesData = blockData
    .filter((d) => d.gasTargetPctAvg !== null)
    .map((d) => ({
      time: d.timestamp as UTCTimestamp,
      value: d.gasTargetPctAvg!,
    }));
```

This skips null data points (like finality chart does) rather than lying about the value.

---

### Task 6: Add Unit Tests

Test the core derivation and lookup functions, plus edge cases.

**Files:**
- Modify: `src/lib/__tests__/gas.test.ts` — add `deriveGasTargetPct` tests
- Create: `src/lib/__tests__/eip1559Params.test.ts` — test `getBfcdForBlock` and `getDefaultGasTargetPct`

**Step 1: Add deriveGasTargetPct tests to gas.test.ts**

Add import of `deriveGasTargetPct` at line 3. Add this test block after the last describe:

```typescript
describe('deriveGasTargetPct', () => {
  // Standard case: 50% gas target (elasticity = 2, pre-Dandeli default)
  // If parent used exactly 50% of gasLimit at the target, baseFee should stay the same
  it('derives ~50% when baseFee unchanged at half-full block', () => {
    // baseFee unchanged means gasUsed == gasTarget
    // R = 0, gasTarget = gasUsed / 1 = gasUsed
    // pct = gasUsed / gasLimit * 100
    const result = deriveGasTargetPct(30, 30, 15000000n, 30000000n, 8);
    expect(result).toBeCloseTo(50, 1);
  });

  // Standard case: 65% gas target (post-Dandeli)
  it('derives ~65% when baseFee unchanged at 65% utilization', () => {
    const result = deriveGasTargetPct(30, 30, 19500000n, 30000000n, 64);
    expect(result).toBeCloseTo(65, 1);
  });

  // BaseFee increases when block is over-target
  it('derives target when baseFee increases', () => {
    // Parent block: 20M gasUsed out of 30M limit, BFCD=8
    // baseFee went from 30 to 30.5 gwei
    // R = (30.5 - 30) / 30 * 8 = 0.1333
    // gasTarget = 20000000 / 1.1333 = ~17647058
    // pct = 17647058 / 30000000 * 100 = ~58.82%
    const result = deriveGasTargetPct(30.5, 30, 20000000n, 30000000n, 8);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(50);
    expect(result!).toBeLessThan(70);
  });

  // Edge case: parent baseFee is 0
  it('returns null when parent baseFee is 0', () => {
    expect(deriveGasTargetPct(30, 0, 15000000n, 30000000n, 8)).toBeNull();
  });

  // Edge case: parent gasUsed is 0
  it('returns null when parent gasUsed is 0', () => {
    expect(deriveGasTargetPct(29, 30, 0n, 30000000n, 8)).toBeNull();
  });

  // Edge case: R + 1 near zero (numerical instability)
  it('returns null when denominator near zero', () => {
    // R + 1 ≈ 0 means R ≈ -1, meaning baseFee dropped nearly 100%
    // baseFee[N] / baseFee[N-1] * BFCD ≈ -1 => baseFee[N] ≈ baseFee[N-1] * (1 - 1/BFCD)
    // For BFCD=1: baseFee must drop to 0
    const result = deriveGasTargetPct(0.001, 100, 15000000n, 30000000n, 1);
    // R = (0.001 - 100) / 100 * 1 = -0.99999, R+1 = 0.00001
    // This might be numerically unstable, but not near 1e-9
    // Actually R+1 = 0.00001 which is > 1e-9, so it won't return null
    // The result will be a huge number failing sanity check
    expect(result).toBeNull(); // sanity check (1-100%) will reject
  });

  // Edge case: parent gasLimit is 0
  it('returns null when parent gasLimit is 0', () => {
    expect(deriveGasTargetPct(30, 30, 15000000n, 0n, 8)).toBeNull();
  });

  // Edge case: result outside 1-100% sanity bounds
  it('returns null when derived pct is outside 1-100%', () => {
    // Craft inputs where formula yields > 100%
    // R very negative but > -1, making gasTarget > gasLimit
    const result = deriveGasTargetPct(10, 30, 25000000n, 30000000n, 8);
    // R = (10-30)/30 * 8 = -5.333, R+1 = -4.333
    // gasTarget = 25000000 / -4.333 = negative -> out of bounds
    expect(result).toBeNull();
  });
});
```

**Step 2: Create eip1559Params.test.ts**

```typescript
import { getBfcdForBlock, getDefaultGasTargetPct, Eip1559Param } from '../eip1559Params';

const PARAMS: Eip1559Param[] = [
  { blockNumber: 23850000n, baseFeeChangeDenominator: 8 },
  { blockNumber: 38189056n, baseFeeChangeDenominator: 16 },
  { blockNumber: 73440256n, baseFeeChangeDenominator: 64 },
];

describe('getBfcdForBlock', () => {
  it('returns null for empty params', () => {
    expect(getBfcdForBlock(50000000n, [])).toBeNull();
  });

  it('returns null for block before first param', () => {
    expect(getBfcdForBlock(23849999n, PARAMS)).toBeNull();
  });

  it('returns first BFCD at exact activation block', () => {
    expect(getBfcdForBlock(23850000n, PARAMS)).toBe(8);
  });

  it('returns first BFCD for block between first and second', () => {
    expect(getBfcdForBlock(30000000n, PARAMS)).toBe(8);
  });

  it('returns second BFCD at exact Delhi activation', () => {
    expect(getBfcdForBlock(38189056n, PARAMS)).toBe(16);
  });

  it('returns second BFCD between Delhi and Bhilai', () => {
    expect(getBfcdForBlock(50000000n, PARAMS)).toBe(16);
  });

  it('returns third BFCD at exact Bhilai activation', () => {
    expect(getBfcdForBlock(73440256n, PARAMS)).toBe(64);
  });

  it('returns latest BFCD for blocks well past last hardfork', () => {
    expect(getBfcdForBlock(90000000n, PARAMS)).toBe(64);
  });

  it('returns correct BFCD at boundary - one block before hardfork', () => {
    expect(getBfcdForBlock(38189055n, PARAMS)).toBe(8);
    expect(getBfcdForBlock(73440255n, PARAMS)).toBe(16);
  });
});

describe('getDefaultGasTargetPct', () => {
  it('returns 50% for blocks before Dandeli', () => {
    expect(getDefaultGasTargetPct(81423999n)).toBe(50);
    expect(getDefaultGasTargetPct(50000000n)).toBe(50);
  });

  it('returns 65% for Dandeli activation block and after', () => {
    expect(getDefaultGasTargetPct(81424000n)).toBe(65);
    expect(getDefaultGasTargetPct(90000000n)).toBe(65);
  });
});
```

**Step 3: Run all tests**

```bash
npm test
```

Expected: All tests pass, including the new tests.

---

### Task 7: Run Tests and Commit

**Step 1: Run all tests**
```bash
npm test
```

**Step 2: TypeScript check**
```bash
npx tsc --noEmit
npx tsc -p tsconfig.indexer.json --noEmit
```

**Step 3: Commit**

```bash
git add -A
git commit -m "fix: address code review issues for gas target feature

- Use current block number (not parent) for BFCD lookup at hardfork boundaries
- Persist carry-forward across batch boundaries in both indexers
- Seed lastGasTargetPct from DB on indexer startup
- Add hourly EIP-1559 param reload in indexers
- Harden admin API: strict validation, 400 on parse errors, 409 on duplicates
- Fix chart rollup to exclude null gas_target_pct from denominator
- Filter null values in chart instead of hardcoding 65% fallback
- Add unit tests for deriveGasTargetPct, getBfcdForBlock, getDefaultGasTargetPct"
```
