// Tests for binance.ts - Binance klines client with host rotation + pure price-row helpers

import {
  getKlines,
  getLatestKlines,
  symbolForHour,
  buildHourlyPriceRows,
  BinanceGeoBlockedError,
  BinanceExhaustedError,
  Kline,
} from '../binance';
import {
  HOUR_MS,
  MATIC_USDT_END_MS,
  POL_USDT_START_MS,
} from '../constants';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock utils (sleep between retry rounds)
jest.mock('../utils', () => ({
  sleep: jest.fn(() => Promise.resolve()),
}));

// Raw kline array as returned by GET /api/v3/klines
function rawKline(openTimeMs: number, close: string): unknown[] {
  return [
    openTimeMs,          // 0: openTime
    '0.4000',            // 1: open
    '0.4600',            // 2: high
    '0.3900',            // 3: low
    close,               // 4: close
    '123456.7',          // 5: volume
    openTimeMs + HOUR_MS - 1, // 6: closeTime
    '55555.5',           // 7: quoteVolume
    1234,                // 8: trades
    '61728.3',           // 9: takerBaseVolume
    '27777.7',           // 10: takerQuoteVolume
    '0',                 // 11: ignore
  ];
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  };
}

describe('getKlines', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses raw kline arrays into {openTimeMs, close}', async () => {
    const t0 = POL_USDT_START_MS;
    mockFetch.mockResolvedValueOnce(okResponse([
      rawKline(t0, '0.4123'),
      rawKline(t0 + HOUR_MS, '0.4200'),
    ]));

    const result = await getKlines('POLUSDT', t0, t0 + 2 * HOUR_MS - 1);

    expect(result).toEqual([
      { openTimeMs: t0, close: 0.4123 },
      { openTimeMs: t0 + HOUR_MS, close: 0.42 },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.binance.com/api/v3/klines?symbol=POLUSDT&interval=1h&startTime=${t0}&endTime=${t0 + 2 * HOUR_MS - 1}&limit=1000`,
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('respects an explicit limit parameter', async () => {
    mockFetch.mockResolvedValueOnce(okResponse([]));

    await getKlines('MATICUSDT', 1000, 2000, 500);

    expect(mockFetch.mock.calls[0][0]).toContain('symbol=MATICUSDT');
    expect(mockFetch.mock.calls[0][0]).toContain('limit=500');
  });

  it('rotates to the next host on failure', async () => {
    const t0 = POL_USDT_START_MS;
    mockFetch
      .mockRejectedValueOnce(new Error('First host down'))
      .mockResolvedValueOnce(okResponse([rawKline(t0, '0.5000')]));

    const result = await getKlines('POLUSDT', t0, t0 + HOUR_MS - 1);

    expect(result).toEqual([{ openTimeMs: t0, close: 0.5 }]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toMatch(/^https:\/\/api\.binance\.com\//);
    expect(mockFetch.mock.calls[1][0]).toMatch(/^https:\/\/api1\.binance\.com\//);
  });

  it('rotates past HTTP errors on non-451 statuses', async () => {
    const t0 = POL_USDT_START_MS;
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
      .mockResolvedValueOnce(okResponse([rawKline(t0, '0.5000')]));

    const result = await getKlines('POLUSDT', t0, t0 + HOUR_MS - 1);

    expect(result).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws BinanceExhaustedError after all hosts and retry rounds fail', async () => {
    mockFetch.mockRejectedValue(new Error('Always fails'));

    await expect(getKlines('POLUSDT', 1000, 2000)).rejects.toThrow(BinanceExhaustedError);
    // 4 hosts x 4 rounds (initial + 3 retries)
    expect(mockFetch).toHaveBeenCalledTimes(16);
  });

  it('throws a geo-blocked error immediately on HTTP 451 (no rotation)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 451,
      statusText: 'Unavailable For Legal Reasons',
    });

    let thrown: unknown;
    try {
      await getKlines('POLUSDT', 1000, 2000);
      fail('Should have thrown');
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(BinanceGeoBlockedError);
    expect((thrown as Error).message).toMatch(/geo-blocked this IP/);
    expect((thrown as Error).message).toContain('https://api.binance.com');
    // IP-based block: retrying other hosts is pointless
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws on malformed kline data', async () => {
    mockFetch.mockResolvedValue(okResponse([[null, '0.4', '0.4', '0.4', 'not-a-number']]));

    await expect(getKlines('POLUSDT', 1000, 2000)).rejects.toThrow(BinanceExhaustedError);
  });
});

describe('getLatestKlines', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches most recent candles without startTime/endTime', async () => {
    const t0 = POL_USDT_START_MS;
    mockFetch.mockResolvedValueOnce(okResponse([
      rawKline(t0, '0.5000'),
      rawKline(t0 + HOUR_MS, '0.5100'),
    ]));

    const result = await getLatestKlines('POLUSDT', 2);

    expect(result).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.binance.com/api/v3/klines?symbol=POLUSDT&interval=1h&limit=2',
      expect.objectContaining({ signal: expect.anything() })
    );
  });
});

describe('symbolForHour', () => {
  it('returns MATICUSDT before the delisting', () => {
    expect(symbolForHour(MATIC_USDT_END_MS - HOUR_MS)).toBe('MATICUSDT');
    expect(symbolForHour(MATIC_USDT_END_MS - 1)).toBe('MATICUSDT');
  });

  it('returns null in the delisting gap', () => {
    expect(symbolForHour(MATIC_USDT_END_MS)).toBeNull();
    expect(symbolForHour(POL_USDT_START_MS - 1)).toBeNull();
  });

  it('returns POLUSDT from the listing', () => {
    expect(symbolForHour(POL_USDT_START_MS)).toBe('POLUSDT');
    expect(symbolForHour(POL_USDT_START_MS + 365 * 24 * HOUR_MS)).toBe('POLUSDT');
  });
});

describe('buildHourlyPriceRows', () => {
  it('maps a normal batch of consecutive klines to binance-sourced rows', () => {
    const t0 = POL_USDT_START_MS;
    const klines: Kline[] = [
      { openTimeMs: t0, close: 0.4 },
      { openTimeMs: t0 + HOUR_MS, close: 0.41 },
      { openTimeMs: t0 + 2 * HOUR_MS, close: 0.42 },
    ];

    const rows = buildHourlyPriceRows(klines, t0, t0 + 3 * HOUR_MS, null);

    expect(rows).toEqual([
      { tsMs: t0, priceUsd: 0.4, source: 'binance:POLUSDT' },
      { tsMs: t0 + HOUR_MS, priceUsd: 0.41, source: 'binance:POLUSDT' },
      { tsMs: t0 + 2 * HOUR_MS, priceUsd: 0.42, source: 'binance:POLUSDT' },
    ]);
  });

  it('carries the last MATIC close forward across the 2024-09-10 -> 2024-09-13 delisting gap', () => {
    const fromHour = MATIC_USDT_END_MS - 2 * HOUR_MS;
    const toHour = POL_USDT_START_MS + 2 * HOUR_MS;
    const gapHours = (POL_USDT_START_MS - MATIC_USDT_END_MS) / HOUR_MS; // 72

    const klines: Kline[] = [
      { openTimeMs: MATIC_USDT_END_MS - 2 * HOUR_MS, close: 0.38 },
      { openTimeMs: MATIC_USDT_END_MS - HOUR_MS, close: 0.39 }, // last MATIC close
      { openTimeMs: POL_USDT_START_MS, close: 0.4 },
      { openTimeMs: POL_USDT_START_MS + HOUR_MS, close: 0.41 },
    ];

    const rows = buildHourlyPriceRows(klines, fromHour, toHour, null);

    expect(rows).toHaveLength(2 + gapHours + 2);
    expect(rows[0]).toEqual({ tsMs: fromHour, priceUsd: 0.38, source: 'binance:MATICUSDT' });
    expect(rows[1]).toEqual({ tsMs: MATIC_USDT_END_MS - HOUR_MS, priceUsd: 0.39, source: 'binance:MATICUSDT' });

    // Every gap hour is carry_forward at the last MATIC close
    const gapRows = rows.slice(2, 2 + gapHours);
    expect(gapRows).toHaveLength(gapHours);
    for (const row of gapRows) {
      expect(row.source).toBe('carry_forward');
      expect(row.priceUsd).toBe(0.39);
    }
    expect(gapRows[0].tsMs).toBe(MATIC_USDT_END_MS);
    expect(gapRows[gapRows.length - 1].tsMs).toBe(POL_USDT_START_MS - HOUR_MS);

    // POL era resumes with real candles
    expect(rows[rows.length - 2]).toEqual({ tsMs: POL_USDT_START_MS, priceUsd: 0.4, source: 'binance:POLUSDT' });
    expect(rows[rows.length - 1]).toEqual({ tsMs: POL_USDT_START_MS + HOUR_MS, priceUsd: 0.41, source: 'binance:POLUSDT' });
  });

  it('derives the source from the symbol boundary (MATIC vs POL hours)', () => {
    const rows = buildHourlyPriceRows(
      [
        { openTimeMs: MATIC_USDT_END_MS - HOUR_MS, close: 0.39 },
        { openTimeMs: POL_USDT_START_MS, close: 0.4 },
      ],
      MATIC_USDT_END_MS - HOUR_MS,
      POL_USDT_START_MS + HOUR_MS,
      null
    );

    expect(rows[0].source).toBe('binance:MATICUSDT');
    expect(rows[rows.length - 1].source).toBe('binance:POLUSDT');
  });

  it('ignores klines that fall inside the delisting gap (carry-forward wins)', () => {
    const rows = buildHourlyPriceRows(
      [
        { openTimeMs: MATIC_USDT_END_MS - HOUR_MS, close: 0.39 },
        { openTimeMs: MATIC_USDT_END_MS, close: 9.99 }, // bogus in-gap kline
      ],
      MATIC_USDT_END_MS - HOUR_MS,
      MATIC_USDT_END_MS + HOUR_MS,
      null
    );

    expect(rows).toEqual([
      { tsMs: MATIC_USDT_END_MS - HOUR_MS, priceUsd: 0.39, source: 'binance:MATICUSDT' },
      { tsMs: MATIC_USDT_END_MS, priceUsd: 0.39, source: 'carry_forward' },
    ]);
  });

  it('skips leading hours while no price is known (null lastKnownPrice)', () => {
    const t0 = POL_USDT_START_MS;
    const rows = buildHourlyPriceRows(
      [{ openTimeMs: t0 + 2 * HOUR_MS, close: 0.42 }],
      t0,
      t0 + 4 * HOUR_MS,
      null
    );

    expect(rows).toEqual([
      { tsMs: t0 + 2 * HOUR_MS, priceUsd: 0.42, source: 'binance:POLUSDT' },
      { tsMs: t0 + 3 * HOUR_MS, priceUsd: 0.42, source: 'carry_forward' },
    ]);
  });

  it('returns no rows for an empty kline list with null lastKnownPrice', () => {
    const t0 = POL_USDT_START_MS;
    expect(buildHourlyPriceRows([], t0, t0 + 5 * HOUR_MS, null)).toEqual([]);
  });

  it('fills an empty kline list entirely from lastKnownPrice', () => {
    const t0 = POL_USDT_START_MS;
    const rows = buildHourlyPriceRows([], t0, t0 + 3 * HOUR_MS, 0.5);

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.priceUsd).toBe(0.5);
      expect(row.source).toBe('carry_forward');
    }
  });

  it('returns no rows for an empty window', () => {
    const t0 = POL_USDT_START_MS;
    expect(buildHourlyPriceRows([], t0, t0, 0.5)).toEqual([]);
  });
});
