// Tests for queries/summaryStats.ts

// Mock the db module before importing the functions
jest.mock('@/lib/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

jest.mock('@/lib/queries/prices', () => ({
  getLatestPrice: jest.fn(),
}));

jest.mock('@/lib/queries/inflation', () => ({
  getAllInflationRates: jest.fn(),
}));

import { queryOne } from '@/lib/db';
import { getAllInflationRates } from '@/lib/queries/inflation';
import { getLatestPrice } from '@/lib/queries/prices';
import { getSummaryStats } from '@/lib/queries/summaryStats';
import type { InflationRate } from '@/lib/types';

const mockQueryOne = queryOne as jest.Mock;
const mockGetAllInflationRates = getAllInflationRates as jest.Mock;
const mockGetLatestPrice = getLatestPrice as jest.Mock;

// Fixed "now": 2026-07-18T12:20:34Z-ish, deliberately NOT minute/hour aligned
const NOW_SEC = 1752841234;
const NOW_MS = NOW_SEC * 1000;

const HOUR = 3600;
const DAY = 86400;

const emptyRow = {
  base_fee_gwei_sum: null,
  priority_fee_gwei_sum: null,
  base_fee_usd_sum: null,
  priority_fee_usd_sum: null,
  usd_missing_hours: '0',
  gas_used_sum: null,
  gas_limit_sum: null,
  tx_count_sum: null,
  block_count: '0',
  block_time_sum: null,
  block_start: null,
  block_end: null,
  finality_avg: null,
  peak_tps: null,
  peak_mgas: null,
};

/**
 * Wire queryOne: the earliest-bucket lookup gets `earliest`, the main
 * aggregate query gets `row`.
 */
function mockDb(row: Record<string, unknown> = emptyRow, earliest: Date | null = null) {
  mockQueryOne.mockImplementation((sql: string) => {
    if (sql.includes('min_bucket')) {
      return Promise.resolve({ min_bucket: earliest });
    }
    return Promise.resolve(row);
  });
}

/** The main aggregate query call (SQL + params), excluding the earliest lookup */
function mainQueryCall(): [string, unknown[]] {
  const calls = mockQueryOne.mock.calls.filter((c) => !(c[0] as string).includes('min_bucket'));
  expect(calls).toHaveLength(1);
  return calls[0] as [string, unknown[]];
}

let dateNowSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
  mockGetLatestPrice.mockResolvedValue(null);
  mockGetAllInflationRates.mockResolvedValue([]);
});

afterEach(() => {
  dateNowSpy.mockRestore();
});

describe('getSummaryStats source routing', () => {
  it('uses raw blocks for a recent 1h range', async () => {
    mockDb();
    const result = await getSummaryStats(NOW_SEC - HOUR, NOW_SEC);

    expect(result.source).toBe('blocks');
    const [sql] = mainQueryCall();
    expect(sql).toContain('FROM blocks b');
    expect(sql).not.toContain('blocks_1min_agg');
  });

  it('uses raw blocks at exactly 6h when recent', async () => {
    mockDb();
    const result = await getSummaryStats(NOW_SEC - 6 * HOUR, NOW_SEC);
    expect(result.source).toBe('blocks');
  });

  it('uses 1min aggregate just above 6h', async () => {
    mockDb();
    const result = await getSummaryStats(NOW_SEC - 6 * HOUR - 60, NOW_SEC);

    expect(result.source).toBe('blocks_1min_agg');
    const [sql] = mainQueryCall();
    expect(sql).toContain('FROM blocks_1min_agg a');
  });

  it('uses 1min aggregate (NOT raw) for a short range older than 24h', async () => {
    mockDb();
    const from = NOW_SEC - 30 * DAY;
    const result = await getSummaryStats(from, from + HOUR);

    expect(result.source).toBe('blocks_1min_agg');
    const [sql] = mainQueryCall();
    expect(sql).not.toContain('FROM blocks b');
  });

  it('uses 1min aggregate up to 7 days', async () => {
    mockDb();
    const result = await getSummaryStats(NOW_SEC - 7 * DAY, NOW_SEC);
    expect(result.source).toBe('blocks_1min_agg');
  });

  it('uses 1hour aggregate above 7 days, with 1min freshness union', async () => {
    mockDb();
    const result = await getSummaryStats(NOW_SEC - 8 * DAY, NOW_SEC);

    expect(result.source).toBe('blocks_1hour_agg');
    const [sql] = mainQueryCall();
    expect(sql).toContain('FROM blocks_1hour_agg');
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain('FROM blocks_1min_agg');
    expect(sql).toContain("MAX(bucket) + INTERVAL '1 hour'");
  });
});

describe('getSummaryStats window snapping', () => {
  it('does not snap for the raw blocks source', async () => {
    mockDb();
    const from = NOW_SEC - HOUR + 7; // deliberately unaligned
    const result = await getSummaryStats(from, NOW_SEC);

    expect(result.range).toEqual({ from, to: NOW_SEC });
    const [, params] = mainQueryCall();
    expect((params[0] as Date).getTime()).toBe(from * 1000);
    expect((params[1] as Date).getTime()).toBe(NOW_SEC * 1000);
  });

  it('snaps to minute boundaries for the 1min aggregate (from floored, to ceiled)', async () => {
    mockDb();
    const from = NOW_SEC - DAY; // NOW_SEC is unaligned, so both ends are unaligned
    const result = await getSummaryStats(from, NOW_SEC);

    expect(result.source).toBe('blocks_1min_agg');
    expect(result.range.from % 60).toBe(0);
    expect(result.range.to % 60).toBe(0);
    expect(result.range.from).toBe(Math.floor(from / 60) * 60);
    expect(result.range.to).toBe(Math.ceil(NOW_SEC / 60) * 60);
    expect(result.range.from).toBeLessThanOrEqual(from);
    expect(result.range.to).toBeGreaterThanOrEqual(NOW_SEC);

    // The query must be issued over the snapped window
    const [, params] = mainQueryCall();
    expect((params[0] as Date).getTime()).toBe(result.range.from * 1000);
    expect((params[1] as Date).getTime()).toBe(result.range.to * 1000);
  });

  it('snaps to hour boundaries for the 1hour aggregate', async () => {
    mockDb();
    const from = NOW_SEC - 30 * DAY + 1234;
    const result = await getSummaryStats(from, NOW_SEC);

    expect(result.source).toBe('blocks_1hour_agg');
    expect(result.range.from % HOUR).toBe(0);
    expect(result.range.to % HOUR).toBe(0);
    expect(result.range.from).toBe(Math.floor(from / HOUR) * HOUR);
    expect(result.range.to).toBe(Math.ceil(NOW_SEC / HOUR) * HOUR);
  });

  it('clamps to to now', async () => {
    mockDb();
    const result = await getSummaryStats(NOW_SEC - HOUR, NOW_SEC + 9999);
    expect(result.range.to).toBe(NOW_SEC);
  });
});

describe('getSummaryStats ALL-range clamping', () => {
  it('clamps from=0 to the earliest data timestamp', async () => {
    const earliest = new Date('2020-06-01T00:00:00Z'); // hour-aligned
    const earliestSec = earliest.getTime() / 1000;
    mockDb(emptyRow, earliest);

    const result = await getSummaryStats(0, NOW_SEC);

    expect(result.source).toBe('blocks_1hour_agg');
    expect(result.range.from).toBe(earliestSec);
  });

  it('clamps a from that predates data', async () => {
    const earliest = new Date('2020-06-01T00:00:00Z');
    mockDb(emptyRow, earliest);

    const result = await getSummaryStats(1000000, NOW_SEC);
    expect(result.range.from).toBe(earliest.getTime() / 1000);
  });

  it('leaves from untouched when no earliest data exists', async () => {
    mockDb(emptyRow, null);
    const result = await getSummaryStats(NOW_SEC - HOUR, NOW_SEC);
    expect(result.range.from).toBe(NOW_SEC - HOUR);
  });
});

describe('getSummaryStats derived math', () => {
  const fullRow = {
    base_fee_gwei_sum: '2000000000', // 2 POL
    priority_fee_gwei_sum: '1000000000', // 1 POL
    base_fee_usd_sum: 0.5,
    priority_fee_usd_sum: 0.25,
    usd_missing_hours: '0',
    gas_used_sum: '30000000000', // 3e10
    gas_limit_sum: '60000000000',
    tx_count_sum: '100000',
    block_count: '3000',
    block_time_sum: '6000',
    block_start: '50000000',
    block_end: '50003000',
    finality_avg: 4.2,
    peak_tps: 512.5,
    peak_mgas: 55.25,
  };

  it('computes fee totals and averages', async () => {
    mockDb(fullRow);
    const result = await getSummaryStats(NOW_SEC - HOUR, NOW_SEC);

    expect(result.fees.basePol).toBeCloseTo(2);
    expect(result.fees.priorityPol).toBeCloseTo(1);
    expect(result.fees.totalPol).toBeCloseTo(3);
    expect(result.fees.baseUsd).toBeCloseTo(0.5);
    expect(result.fees.priorityUsd).toBeCloseTo(0.25);
    expect(result.fees.totalUsd).toBeCloseTo(0.75);
    expect(result.fees.avgTxFeePol).toBeCloseTo(3 / 100000);
    expect(result.fees.avgTxFeeUsd).toBeCloseTo(0.75 / 100000);
  });

  it('computes throughput and block stats', async () => {
    mockDb(fullRow);
    const result = await getSummaryStats(NOW_SEC - HOUR, NOW_SEC);

    expect(result.throughput.avgTps).toBeCloseTo(100000 / 6000);
    expect(result.throughput.avgMgas).toBeCloseTo(30000000000 / 6000 / 1e6); // = 5
    expect(result.throughput.peakTps).toBe(512.5);
    expect(result.throughput.peakMgas).toBe(55.25);

    expect(result.blocks.count).toBe(3000);
    expect(result.blocks.txCount).toBe(100000);
    expect(result.blocks.avgBlockTimeSec).toBeCloseTo(2);
    expect(result.blocks.gasUsedSum).toBe(30000000000);
    expect(result.blocks.utilizationPct).toBeCloseTo(50);
    expect(result.blocks.blockStart).toBe(50000000);
    expect(result.blocks.blockEnd).toBe(50003000);
    expect(result.blocks.avgFinalitySec).toBe(4.2);
  });

  it('null-guards all divisions when denominators are zero', async () => {
    mockDb({
      ...emptyRow,
      usd_missing_hours: '0',
      gas_used_sum: '0',
      gas_limit_sum: '0',
      tx_count_sum: '0',
      block_count: '0',
      block_time_sum: '0',
    });
    const result = await getSummaryStats(NOW_SEC - HOUR, NOW_SEC);

    expect(result.fees.basePol).toBe(0);
    expect(result.fees.totalPol).toBe(0);
    expect(result.fees.avgTxFeePol).toBeNull();
    expect(result.fees.avgTxFeeUsd).toBeNull();
    expect(result.throughput.avgTps).toBeNull();
    expect(result.throughput.avgMgas).toBeNull();
    expect(result.throughput.peakTps).toBeNull();
    expect(result.throughput.peakMgas).toBeNull();
    expect(result.blocks.avgBlockTimeSec).toBeNull();
    expect(result.blocks.utilizationPct).toBeNull();
    expect(result.blocks.blockStart).toBeNull();
    expect(result.blocks.blockEnd).toBeNull();
    expect(result.blocks.avgFinalitySec).toBeNull();
  });

  it('returns null USD totals when no price data joined', async () => {
    mockDb({ ...fullRow, base_fee_usd_sum: null, priority_fee_usd_sum: null });
    const result = await getSummaryStats(NOW_SEC - HOUR, NOW_SEC);

    expect(result.fees.baseUsd).toBeNull();
    expect(result.fees.priorityUsd).toBeNull();
    expect(result.fees.totalUsd).toBeNull();
    expect(result.fees.avgTxFeeUsd).toBeNull(); // txCount > 0 but no USD data
    expect(result.fees.avgTxFeePol).not.toBeNull();
  });

  it('passes usdMissingHours through', async () => {
    mockDb({ ...fullRow, usd_missing_hours: '5' });
    const result = await getSummaryStats(NOW_SEC - HOUR, NOW_SEC);
    expect(result.fees.usdMissingHours).toBe(5);
  });

  it('returns the latest price', async () => {
    mockDb(fullRow);
    mockGetLatestPrice.mockResolvedValue({
      ts: new Date('2026-07-18T12:00:00Z'),
      priceUsd: 0.5,
      source: 'binance:POLUSDT',
    });
    const result = await getSummaryStats(NOW_SEC - HOUR, NOW_SEC);
    expect(result.priceUsd).toBe(0.5);
  });
});

describe('getSummaryStats inflation', () => {
  const POL_SUPPLY_10B_WEI = 10_000_000_000n * 10n ** 18n;

  // Flat rate (interestPerYearLog2 = 0) => issuance is exactly 0, supply constant
  const flatRate: InflationRate = {
    id: 1,
    blockNumber: 1n,
    blockTimestamp: new Date(0),
    interestPerYearLog2: 0n,
    startSupply: POL_SUPPLY_10B_WEI,
    startTimestamp: 0n,
    createdAt: new Date(0),
  };

  it('is null when no inflation rates exist', async () => {
    mockDb();
    mockGetAllInflationRates.mockResolvedValue([]);
    const result = await getSummaryStats(NOW_SEC - HOUR, NOW_SEC);
    expect(result.inflation).toBeNull();
  });

  it('computes net inflation = issuance - burn', async () => {
    mockDb({ ...emptyRow, base_fee_gwei_sum: '5000000000' }); // 5 POL burned
    mockGetAllInflationRates.mockResolvedValue([flatRate]);
    mockGetLatestPrice.mockResolvedValue({
      ts: new Date('2026-07-18T12:00:00Z'),
      priceUsd: 0.5,
      source: 'binance:POLUSDT',
    });

    const result = await getSummaryStats(NOW_SEC - HOUR, NOW_SEC);

    expect(result.inflation).not.toBeNull();
    expect(result.inflation!.issuancePol).toBe(0);
    expect(result.inflation!.burnedPol).toBeCloseTo(5);
    expect(result.inflation!.netInflationPol).toBeCloseTo(-5);
    expect(result.inflation!.netInflationUsd).toBeCloseTo(-2.5);
    // -5 POL of 10B supply, as a percentage
    expect(result.inflation!.netInflationPctOfSupply).toBeCloseTo((-5 / 1e10) * 100, 12);
  });

  it('leaves netInflationUsd null without a latest price', async () => {
    mockDb({ ...emptyRow, base_fee_gwei_sum: '5000000000' });
    mockGetAllInflationRates.mockResolvedValue([flatRate]);
    mockGetLatestPrice.mockResolvedValue(null);

    const result = await getSummaryStats(NOW_SEC - HOUR, NOW_SEC);
    expect(result.inflation!.netInflationUsd).toBeNull();
    expect(result.priceUsd).toBeNull();
  });
});
