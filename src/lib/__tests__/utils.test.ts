// Tests for utils.ts - utility functions

import {
  sleep,
  getTimeAgo,
  formatLargeNumber,
  formatGas,
  formatGweiToPol,
  formatPol,
  getGasUtilizationColor,
  calculateGasPercent,
} from '../utils';

describe('sleep', () => {
  it('resolves after specified milliseconds', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;

    // Allow some tolerance for timing
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(100);
  });

  it('returns a promise', () => {
    const result = sleep(1);
    expect(result).toBeInstanceOf(Promise);
  });
});

describe('getTimeAgo', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns seconds ago for recent times', () => {
    const date = new Date('2024-01-15T11:59:30Z'); // 30s ago
    expect(getTimeAgo(date)).toBe('30s ago');
  });

  it('returns minutes ago for times < 1 hour', () => {
    const date = new Date('2024-01-15T11:45:00Z'); // 15m ago
    expect(getTimeAgo(date)).toBe('15m ago');
  });

  it('returns hours ago for times < 1 day', () => {
    const date = new Date('2024-01-15T09:00:00Z'); // 3h ago
    expect(getTimeAgo(date)).toBe('3h ago');
  });

  it('returns days ago for times >= 1 day', () => {
    const date = new Date('2024-01-13T12:00:00Z'); // 2d ago
    expect(getTimeAgo(date)).toBe('2d ago');
  });
});

describe('formatLargeNumber', () => {
  it('formats billions with B suffix', () => {
    expect(formatLargeNumber(1_000_000_000)).toBe('1.00B');
    expect(formatLargeNumber(15_500_000_000)).toBe('15.50B');
  });

  it('formats millions with M suffix', () => {
    expect(formatLargeNumber(1_000_000)).toBe('1.00M');
    expect(formatLargeNumber(25_500_000)).toBe('25.50M');
  });

  it('formats thousands with K suffix', () => {
    expect(formatLargeNumber(1_000)).toBe('1.00K');
    expect(formatLargeNumber(50_500)).toBe('50.50K');
  });

  it('formats small numbers without suffix', () => {
    expect(formatLargeNumber(500)).toBe('500.00');
    expect(formatLargeNumber(0)).toBe('0.00');
  });

  it('respects custom decimal places', () => {
    expect(formatLargeNumber(1_500_000, 1)).toBe('1.5M');
    expect(formatLargeNumber(1_500_000, 3)).toBe('1.500M');
  });
});

describe('formatGas', () => {
  it('formats billions with B suffix', () => {
    expect(formatGas('1000000000')).toBe('1.00B');
    expect(formatGas('15000000000')).toBe('15.00B');
  });

  it('formats millions with M suffix', () => {
    expect(formatGas('15000000')).toBe('15.00M');
    expect(formatGas('1000000')).toBe('1.00M');
  });

  it('formats thousands with K suffix', () => {
    expect(formatGas('21000')).toBe('21.0K');
    expect(formatGas('1000')).toBe('1.0K');
  });

  it('formats small numbers without suffix', () => {
    expect(formatGas('500')).toBe('500');
    expect(formatGas('0')).toBe('0');
  });
});

describe('formatGweiToPol', () => {
  it('converts gwei to POL', () => {
    // 1 POL = 1,000,000,000 gwei
    expect(formatGweiToPol(1_000_000_000)).toBe('1.0000');
    expect(formatGweiToPol(500_000_000)).toBe('0.5000');
  });

  it('returns dash for undefined', () => {
    expect(formatGweiToPol(undefined)).toBe('-');
  });

  it('returns "calculating" for null (pending)', () => {
    expect(formatGweiToPol(null)).toBe('calculating');
  });

  it('respects custom decimal places', () => {
    expect(formatGweiToPol(1_000_000_000, 2)).toBe('1.00');
    expect(formatGweiToPol(1_500_000_000, 3)).toBe('1.500');
  });

  it('formats with locale-specific thousands separator', () => {
    expect(formatGweiToPol(1_000_000_000_000)).toMatch(/1,000\.0000/);
  });
});

describe('formatPol', () => {
  it('formats POL values with commas', () => {
    expect(formatPol(1000)).toBe('1,000.00');
    expect(formatPol(1_000_000)).toBe('1,000,000.00');
  });

  it('respects custom decimal places', () => {
    expect(formatPol(1234.5678, 4)).toBe('1,234.5678');
    expect(formatPol(1234.5, 1)).toBe('1,234.5');
  });
});

describe('getGasUtilizationColor', () => {
  it('returns green for optimal range (55-75%)', () => {
    expect(getGasUtilizationColor(55)).toBe('bg-green-500');
    expect(getGasUtilizationColor(65)).toBe('bg-green-500');
    expect(getGasUtilizationColor(75)).toBe('bg-green-500');
  });

  it('returns yellow for suboptimal range (15-55% or 75-85%)', () => {
    expect(getGasUtilizationColor(15)).toBe('bg-yellow-500');
    expect(getGasUtilizationColor(54)).toBe('bg-yellow-500');
    expect(getGasUtilizationColor(76)).toBe('bg-yellow-500');
    expect(getGasUtilizationColor(85)).toBe('bg-yellow-500');
  });

  it('returns red for extreme values (<15% or >85%)', () => {
    expect(getGasUtilizationColor(0)).toBe('bg-red-500');
    expect(getGasUtilizationColor(14)).toBe('bg-red-500');
    expect(getGasUtilizationColor(86)).toBe('bg-red-500');
    expect(getGasUtilizationColor(100)).toBe('bg-red-500');
  });
});

describe('calculateGasPercent', () => {
  it('calculates percentage from bigint values', () => {
    expect(calculateGasPercent(50n, 100n)).toBe(50);
    expect(calculateGasPercent(65n, 100n)).toBe(65);
  });

  it('calculates percentage from string values', () => {
    expect(calculateGasPercent('15000000', '30000000')).toBe(50);
    expect(calculateGasPercent('19500000', '30000000')).toBe(65);
  });

  it('handles mixed types', () => {
    expect(calculateGasPercent(15000000n, '30000000')).toBe(50);
    expect(calculateGasPercent('15000000', 30000000n)).toBe(50);
  });

  it('returns 0 when limit is 0', () => {
    expect(calculateGasPercent(1000n, 0n)).toBe(0);
    expect(calculateGasPercent('1000', '0')).toBe(0);
  });

  it('returns 0 when gasUsed is 0', () => {
    expect(calculateGasPercent(0n, 100n)).toBe(0);
    expect(calculateGasPercent('0', '100')).toBe(0);
  });
});
