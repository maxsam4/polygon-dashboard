// Tests for indexers/priceIndexer.ts - cursor init, backfill/steady mode selection,
// closed-candle cursor advancement

jest.mock('../indexers/indexerState', () => ({
  getIndexerState: jest.fn(),
  initializeIndexerState: jest.fn(),
  updateIndexerState: jest.fn(),
}));

jest.mock('../queries/prices', () => ({
  upsertPricesBatch: jest.fn(),
  getLatestPrice: jest.fn(),
  getPriceCoverage: jest.fn(),
}));

jest.mock('../workers/workerStatus', () => ({
  initWorkerStatus: jest.fn(),
  updateWorkerState: jest.fn(),
  updateWorkerRun: jest.fn(),
  updateWorkerError: jest.fn(),
}));

// Keep the pure helpers (buildHourlyPriceRows, symbolForHour) real; mock the network calls
jest.mock('../binance', () => ({
  ...jest.requireActual('../binance'),
  getKlines: jest.fn(),
  getLatestKlines: jest.fn(),
}));

jest.mock('../utils', () => ({
  sleep: jest.fn(() => Promise.resolve()),
}));

import { PriceIndexer } from '../indexers/priceIndexer';
import { getIndexerState, initializeIndexerState, updateIndexerState } from '../indexers/indexerState';
import { upsertPricesBatch, getLatestPrice, getPriceCoverage } from '../queries/prices';
import { getKlines, getLatestKlines } from '../binance';
import {
  BINANCE_KLINE_LIMIT,
  HOUR_MS,
  MATIC_USDT_END_MS,
  POL_USDT_START_MS,
  PRICE_HISTORY_START_MS,
} from '../constants';

const mockGetIndexerState = getIndexerState as jest.Mock;
const mockInitializeIndexerState = initializeIndexerState as jest.Mock;
const mockUpdateIndexerState = updateIndexerState as jest.Mock;
const mockUpsertPricesBatch = upsertPricesBatch as jest.Mock;
const mockGetLatestPrice = getLatestPrice as jest.Mock;
const mockGetPriceCoverage = getPriceCoverage as jest.Mock;
const mockGetKlines = getKlines as jest.Mock;
const mockGetLatestKlines = getLatestKlines as jest.Mock;

// A fixed "now" in the POL era: some hour boundary + 30 minutes
const BASE_HOUR_MS = POL_USDT_START_MS + 10_000 * HOUR_MS; // hour-aligned
const NOW_MS = BASE_HOUR_MS + 30 * 60 * 1000;

describe('PriceIndexer', () => {
  let indexer: PriceIndexer;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);

    indexer = new PriceIndexer();

    // Defaults: fresh state everywhere
    mockGetIndexerState.mockResolvedValue(null);
    mockGetPriceCoverage.mockResolvedValue({ minTs: null, maxTs: null, count: 0 });
    mockGetLatestPrice.mockResolvedValue(null);
    mockGetKlines.mockResolvedValue([]);
    mockGetLatestKlines.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('cursor initialization', () => {
    it('resumes from indexer_state when present (highest precedence)', async () => {
      const cursorSec = Math.floor((BASE_HOUR_MS - 5 * HOUR_MS) / 1000);
      mockGetIndexerState.mockResolvedValue({ blockNumber: BigInt(cursorSec), hash: '' });

      await indexer.init();

      expect(indexer.cursor).toBe(cursorSec);
      // Coverage lookup and re-initialization are skipped
      expect(mockGetPriceCoverage).not.toHaveBeenCalled();
      expect(mockInitializeIndexerState).not.toHaveBeenCalled();
    });

    it('falls back to MAX(ts) from pol_prices when no indexer_state exists', async () => {
      const maxTs = new Date(BASE_HOUR_MS - 10 * HOUR_MS);
      mockGetPriceCoverage.mockResolvedValue({ minTs: new Date(PRICE_HISTORY_START_MS), maxTs, count: 42 });
      mockGetLatestPrice.mockResolvedValue({ ts: maxTs, priceUsd: 0.45, source: 'binance:POLUSDT' });

      await indexer.init();

      const expectedCursorSec = Math.floor(maxTs.getTime() / 1000);
      expect(indexer.cursor).toBe(expectedCursorSec);
      expect(mockInitializeIndexerState).toHaveBeenCalledWith('price_indexer', BigInt(expectedCursorSec), '');
    });

    it('falls back to PRICE_HISTORY_START when no state and no prices exist', async () => {
      await indexer.init();

      // Cursor sits one hour before history start so the first backfill window
      // (cursor + 1h) begins exactly at PRICE_HISTORY_START
      const expectedCursorSec = Math.floor((PRICE_HISTORY_START_MS - HOUR_MS) / 1000);
      expect(indexer.cursor).toBe(expectedCursorSec);
      expect(mockInitializeIndexerState).toHaveBeenCalledWith('price_indexer', BigInt(expectedCursorSec), '');
    });

    it('first backfill after fresh init fetches MATICUSDT starting at PRICE_HISTORY_START', async () => {
      await indexer.init();
      const mode = await indexer.tick();

      expect(mode).toBe('backfill');
      expect(mockGetKlines).toHaveBeenCalledWith(
        'MATICUSDT',
        PRICE_HISTORY_START_MS,
        PRICE_HISTORY_START_MS + BINANCE_KLINE_LIMIT * HOUR_MS - 1,
        BINANCE_KLINE_LIMIT
      );
    });
  });

  describe('mode selection', () => {
    it('runs a backfill step when the cursor is more than 2h behind now', async () => {
      const cursorSec = Math.floor((BASE_HOUR_MS - 3 * HOUR_MS) / 1000);
      mockGetIndexerState.mockResolvedValue({ blockNumber: BigInt(cursorSec), hash: '' });
      await indexer.init();

      const mode = await indexer.tick();

      expect(mode).toBe('backfill');
      expect(mockGetKlines).toHaveBeenCalledTimes(1);
      expect(mockGetLatestKlines).not.toHaveBeenCalled();
    });

    it('runs a steady step when the cursor is within 2h of now', async () => {
      const cursorSec = Math.floor((BASE_HOUR_MS - HOUR_MS) / 1000);
      mockGetIndexerState.mockResolvedValue({ blockNumber: BigInt(cursorSec), hash: '' });
      await indexer.init();

      const mode = await indexer.tick();

      expect(mode).toBe('steady');
      expect(mockGetLatestKlines).toHaveBeenCalledWith('POLUSDT', 2);
      expect(mockGetKlines).not.toHaveBeenCalled();
    });
  });

  describe('backfill step', () => {
    it('upserts the fetched window and advances the cursor to the last closed hour written', async () => {
      const cursorSec = Math.floor((BASE_HOUR_MS - 3 * HOUR_MS) / 1000);
      mockGetIndexerState.mockResolvedValue({ blockNumber: BigInt(cursorSec), hash: '' });
      await indexer.init();

      // Window = [BASE-2h, BASE) -> two closed candles (last closed hour is BASE-1h)
      mockGetKlines.mockResolvedValue([
        { openTimeMs: BASE_HOUR_MS - 2 * HOUR_MS, close: 0.5 },
        { openTimeMs: BASE_HOUR_MS - HOUR_MS, close: 0.51 },
      ]);

      await indexer.tick();

      expect(mockGetKlines).toHaveBeenCalledWith(
        'POLUSDT',
        BASE_HOUR_MS - 2 * HOUR_MS,
        BASE_HOUR_MS - 1,
        BINANCE_KLINE_LIMIT
      );
      expect(mockUpsertPricesBatch).toHaveBeenCalledWith([
        { tsMs: BASE_HOUR_MS - 2 * HOUR_MS, priceUsd: 0.5, source: 'binance:POLUSDT' },
        { tsMs: BASE_HOUR_MS - HOUR_MS, priceUsd: 0.51, source: 'binance:POLUSDT' },
      ]);

      const expectedCursorSec = Math.floor((BASE_HOUR_MS - HOUR_MS) / 1000);
      expect(indexer.cursor).toBe(expectedCursorSec);
      expect(mockUpdateIndexerState).toHaveBeenCalledWith('price_indexer', BigInt(expectedCursorSec), '');
    });

    it('clamps a window straddling the MATIC delisting and carry-forward-fills the gap', async () => {
      // Cursor two hours before the delisting; now is far in the future (POL era)
      const cursorSec = Math.floor((MATIC_USDT_END_MS - 2 * HOUR_MS) / 1000);
      mockGetIndexerState.mockResolvedValue({ blockNumber: BigInt(cursorSec), hash: '' });
      await indexer.init();

      mockGetKlines.mockResolvedValue([
        { openTimeMs: MATIC_USDT_END_MS - HOUR_MS, close: 0.39 }, // last MATIC candle
      ]);

      await indexer.tick();

      // Fetch is MATICUSDT with endTime clamped at the delisting boundary
      expect(mockGetKlines).toHaveBeenCalledWith(
        'MATICUSDT',
        MATIC_USDT_END_MS - HOUR_MS,
        MATIC_USDT_END_MS - 1,
        BINANCE_KLINE_LIMIT
      );

      // Rows: 1 MATIC candle + 72 carry-forward gap hours (window stops before POL listing)
      const gapHours = (POL_USDT_START_MS - MATIC_USDT_END_MS) / HOUR_MS;
      const rows = mockUpsertPricesBatch.mock.calls[0][0];
      expect(rows).toHaveLength(1 + gapHours);
      expect(rows[0]).toEqual({ tsMs: MATIC_USDT_END_MS - HOUR_MS, priceUsd: 0.39, source: 'binance:MATICUSDT' });
      expect(rows[rows.length - 1]).toEqual({
        tsMs: POL_USDT_START_MS - HOUR_MS,
        priceUsd: 0.39,
        source: 'carry_forward',
      });

      // Cursor lands on the last gap hour; next tick starts at the POL listing
      expect(indexer.cursor).toBe(Math.floor((POL_USDT_START_MS - HOUR_MS) / 1000));
    });

    it('clamps the fetch startTime to the POL listing when resuming inside the gap', async () => {
      const cursorSec = Math.floor((POL_USDT_START_MS - 10 * HOUR_MS) / 1000);
      mockGetIndexerState.mockResolvedValue({ blockNumber: BigInt(cursorSec), hash: '' });
      mockGetLatestPrice.mockResolvedValue({ ts: new Date(), priceUsd: 0.39, source: 'binance:MATICUSDT' });
      await indexer.init();

      mockGetKlines.mockResolvedValue([{ openTimeMs: POL_USDT_START_MS, close: 0.4 }]);

      await indexer.tick();

      expect(mockGetKlines).toHaveBeenCalledWith(
        'POLUSDT',
        POL_USDT_START_MS,
        expect.any(Number),
        BINANCE_KLINE_LIMIT
      );

      // Gap hours before the listing are carry-forward from the last known price
      const rows = mockUpsertPricesBatch.mock.calls[0][0];
      expect(rows[0]).toEqual({
        tsMs: POL_USDT_START_MS - 9 * HOUR_MS,
        priceUsd: 0.39,
        source: 'carry_forward',
      });
    });
  });

  describe('steady step', () => {
    it('upserts both candles but only advances the cursor past the CLOSED one', async () => {
      // 1.5h behind now (exactly 2h would still be steady; >2h triggers backfill)
      const cursorSec = Math.floor((BASE_HOUR_MS - 1.5 * HOUR_MS) / 1000);
      mockGetIndexerState.mockResolvedValue({ blockNumber: BigInt(cursorSec), hash: '' });
      await indexer.init();

      // Previous hour is closed (openTime + 1h <= now); current hour is in progress
      mockGetLatestKlines.mockResolvedValue([
        { openTimeMs: BASE_HOUR_MS - HOUR_MS, close: 0.5 },
        { openTimeMs: BASE_HOUR_MS, close: 0.51 },
      ]);

      const mode = await indexer.tick();

      expect(mode).toBe('steady');
      expect(mockUpsertPricesBatch).toHaveBeenCalledWith([
        { tsMs: BASE_HOUR_MS - HOUR_MS, priceUsd: 0.5, source: 'binance:POLUSDT' },
        { tsMs: BASE_HOUR_MS, priceUsd: 0.51, source: 'binance:POLUSDT' },
      ]);

      // Cursor stops at the closed candle, NOT the in-progress current hour
      const expectedCursorSec = Math.floor((BASE_HOUR_MS - HOUR_MS) / 1000);
      expect(indexer.cursor).toBe(expectedCursorSec);
      expect(mockUpdateIndexerState).toHaveBeenCalledWith('price_indexer', BigInt(expectedCursorSec), '');
    });

    it('does not regress or rewrite the cursor when no newer candle has closed', async () => {
      const cursorSec = Math.floor((BASE_HOUR_MS - HOUR_MS) / 1000);
      mockGetIndexerState.mockResolvedValue({ blockNumber: BigInt(cursorSec), hash: '' });
      await indexer.init();

      mockGetLatestKlines.mockResolvedValue([
        { openTimeMs: BASE_HOUR_MS - HOUR_MS, close: 0.5 }, // already past this one
        { openTimeMs: BASE_HOUR_MS, close: 0.51 },          // still in progress
      ]);

      await indexer.tick();

      expect(indexer.cursor).toBe(cursorSec);
      expect(mockUpdateIndexerState).not.toHaveBeenCalled();
      // Both rows are still upserted (in-progress candle refresh)
      expect(mockUpsertPricesBatch).toHaveBeenCalledTimes(1);
    });

    it('does nothing when Binance returns no candles', async () => {
      const cursorSec = Math.floor((BASE_HOUR_MS - HOUR_MS) / 1000);
      mockGetIndexerState.mockResolvedValue({ blockNumber: BigInt(cursorSec), hash: '' });
      await indexer.init();

      mockGetLatestKlines.mockResolvedValue([]);

      await indexer.tick();

      expect(mockUpsertPricesBatch).not.toHaveBeenCalled();
      expect(mockUpdateIndexerState).not.toHaveBeenCalled();
      expect(indexer.cursor).toBe(cursorSec);
    });
  });
});
