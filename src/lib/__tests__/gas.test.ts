// Tests for gas.ts - calculateBlockMetrics and utility functions

import { calculateBlockMetrics, weiToGwei, formatGwei, formatNumber } from '../gas';

describe('weiToGwei', () => {
  it('converts wei to gwei correctly', () => {
    expect(weiToGwei(1000000000n)).toBe(1);
    expect(weiToGwei(30000000000n)).toBe(30);
    expect(weiToGwei(0n)).toBe(0);
  });

  it('handles fractional gwei', () => {
    expect(weiToGwei(500000000n)).toBe(0.5);
    expect(weiToGwei(1500000000n)).toBe(1.5);
  });
});

describe('formatGwei', () => {
  it('formats very small values with 4 decimals', () => {
    expect(formatGwei(0.001)).toBe('0.0010');
    expect(formatGwei(0.0001)).toBe('0.0001');
  });

  it('formats small values with 3 decimals', () => {
    expect(formatGwei(0.5)).toBe('0.500');
    expect(formatGwei(0.123)).toBe('0.123');
  });

  it('formats medium values with 2 decimals', () => {
    expect(formatGwei(30)).toBe('30.00');
    expect(formatGwei(99.99)).toBe('99.99');
  });

  it('formats large values with 1 decimal', () => {
    expect(formatGwei(100)).toBe('100.0');
    expect(formatGwei(500.5)).toBe('500.5');
  });
});

describe('formatNumber', () => {
  it('formats millions with M suffix', () => {
    expect(formatNumber(1000000)).toBe('1.00M');
    expect(formatNumber(15000000)).toBe('15.00M');
  });

  it('formats thousands with K suffix', () => {
    expect(formatNumber(1000)).toBe('1.00K');
    expect(formatNumber(50000)).toBe('50.00K');
  });

  it('formats small numbers without suffix', () => {
    expect(formatNumber(500)).toBe('500.00');
    expect(formatNumber(0)).toBe('0.00');
  });
});

describe('calculateBlockMetrics', () => {
  const GWEI = 1_000_000_000n;

  describe('empty blocks', () => {
    it('returns zero priority fees for empty block', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 0n,
        timestamp: 1000n,
        transactions: [],
      };

      const metrics = calculateBlockMetrics(block);

      expect(metrics.baseFeeGwei).toBe(30);
      expect(metrics.minPriorityFeeGwei).toBe(0);
      expect(metrics.maxPriorityFeeGwei).toBe(0);
      expect(metrics.medianPriorityFeeGwei).toBe(0);
      expect(metrics.totalBaseFeeGwei).toBe(0);
    });
  });

  describe('EIP-1559 transactions', () => {
    it('calculates priority fees from maxPriorityFeePerGas', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 63000n, // 3 * 21000
        timestamp: 1000n,
        transactions: [
          { maxPriorityFeePerGas: 5n * GWEI, gas: 21000n, gasUsed: 21000n },
          { maxPriorityFeePerGas: 10n * GWEI, gas: 21000n, gasUsed: 21000n },
          { maxPriorityFeePerGas: 15n * GWEI, gas: 21000n, gasUsed: 21000n },
        ],
      };

      const metrics = calculateBlockMetrics(block);

      expect(metrics.minPriorityFeeGwei).toBe(5);
      expect(metrics.maxPriorityFeeGwei).toBe(15);
      expect(metrics.medianPriorityFeeGwei).toBe(10);
    });

    it('handles null maxPriorityFeePerGas', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 42000n,
        timestamp: 1000n,
        transactions: [
          { maxPriorityFeePerGas: null, gas: 21000n, gasUsed: 21000n },
          { maxPriorityFeePerGas: 10n * GWEI, gas: 21000n, gasUsed: 21000n },
        ],
      };

      const metrics = calculateBlockMetrics(block);

      expect(metrics.minPriorityFeeGwei).toBe(0);
      expect(metrics.maxPriorityFeeGwei).toBe(10);
    });
  });

  describe('legacy transactions', () => {
    it('calculates priority fee from gasPrice - baseFee', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 42000n,
        timestamp: 1000n,
        transactions: [
          { gasPrice: 40n * GWEI, gas: 21000n, gasUsed: 21000n }, // priority = 10
          { gasPrice: 50n * GWEI, gas: 21000n, gasUsed: 21000n }, // priority = 20
        ],
      };

      const metrics = calculateBlockMetrics(block);

      expect(metrics.minPriorityFeeGwei).toBe(10);
      expect(metrics.maxPriorityFeeGwei).toBe(20);
    });

    it('clamps negative priority fee to zero', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 21000n,
        timestamp: 1000n,
        transactions: [
          { gasPrice: 25n * GWEI, gas: 21000n, gasUsed: 21000n }, // gasPrice < baseFee
        ],
      };

      const metrics = calculateBlockMetrics(block);

      expect(metrics.minPriorityFeeGwei).toBe(0);
      expect(metrics.maxPriorityFeeGwei).toBe(0);
    });

    it('uses full gasPrice when no baseFee (pre-EIP-1559)', () => {
      const block = {
        baseFeePerGas: 0n,
        gasUsed: 21000n,
        timestamp: 1000n,
        transactions: [
          { gasPrice: 50n * GWEI, gas: 21000n, gasUsed: 21000n },
        ],
      };

      const metrics = calculateBlockMetrics(block);

      expect(metrics.minPriorityFeeGwei).toBe(50);
      expect(metrics.maxPriorityFeeGwei).toBe(50);
    });
  });

  describe('mixed transaction types', () => {
    it('handles both EIP-1559 and legacy transactions', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 63000n,
        timestamp: 1000n,
        transactions: [
          { maxPriorityFeePerGas: 5n * GWEI, gas: 21000n, gasUsed: 21000n },
          { gasPrice: 45n * GWEI, gas: 21000n, gasUsed: 21000n }, // priority = 15
          { maxPriorityFeePerGas: 25n * GWEI, gas: 21000n, gasUsed: 21000n },
        ],
      };

      const metrics = calculateBlockMetrics(block);

      expect(metrics.minPriorityFeeGwei).toBe(5);
      expect(metrics.maxPriorityFeeGwei).toBe(25);
      expect(metrics.medianPriorityFeeGwei).toBe(15);
    });
  });

  describe('median calculation', () => {
    it('calculates median for odd number of transactions', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 105000n,
        timestamp: 1000n,
        transactions: [
          { maxPriorityFeePerGas: 1n * GWEI, gas: 21000n, gasUsed: 21000n },
          { maxPriorityFeePerGas: 3n * GWEI, gas: 21000n, gasUsed: 21000n },
          { maxPriorityFeePerGas: 5n * GWEI, gas: 21000n, gasUsed: 21000n },
          { maxPriorityFeePerGas: 7n * GWEI, gas: 21000n, gasUsed: 21000n },
          { maxPriorityFeePerGas: 9n * GWEI, gas: 21000n, gasUsed: 21000n },
        ],
      };

      const metrics = calculateBlockMetrics(block);

      expect(metrics.medianPriorityFeeGwei).toBe(5);
    });

    it('calculates median for even number of transactions', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 84000n,
        timestamp: 1000n,
        transactions: [
          { maxPriorityFeePerGas: 2n * GWEI, gas: 21000n, gasUsed: 21000n },
          { maxPriorityFeePerGas: 4n * GWEI, gas: 21000n, gasUsed: 21000n },
          { maxPriorityFeePerGas: 6n * GWEI, gas: 21000n, gasUsed: 21000n },
          { maxPriorityFeePerGas: 8n * GWEI, gas: 21000n, gasUsed: 21000n },
        ],
      };

      const metrics = calculateBlockMetrics(block);

      expect(metrics.medianPriorityFeeGwei).toBe(5); // (4 + 6) / 2
    });
  });

  describe('weighted average with gasUsed', () => {
    it('returns null avgPriorityFeeGwei when gasUsed not available', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 42000n,
        timestamp: 1000n,
        transactions: [
          { maxPriorityFeePerGas: 5n * GWEI, gas: 21000n }, // no gasUsed
          { maxPriorityFeePerGas: 10n * GWEI, gas: 21000n },
        ],
      };

      const metrics = calculateBlockMetrics(block);

      expect(metrics.avgPriorityFeeGwei).toBeNull();
      expect(metrics.totalPriorityFeeGwei).toBeNull();
    });

    it('calculates weighted average when all gasUsed available', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 42000n,
        timestamp: 1000n,
        transactions: [
          { maxPriorityFeePerGas: 10n * GWEI, gas: 21000n, gasUsed: 21000n },
          { maxPriorityFeePerGas: 20n * GWEI, gas: 21000n, gasUsed: 21000n },
        ],
      };

      const metrics = calculateBlockMetrics(block);

      // Total priority fees: (10 * 21000 + 20 * 21000) = 630000 gwei
      expect(metrics.avgPriorityFeeGwei).not.toBeNull();
      expect(metrics.totalPriorityFeeGwei).not.toBeNull();
    });
  });

  describe('block time and throughput', () => {
    it('calculates block time from previous timestamp', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 15000000n,
        timestamp: 1002n,
        transactions: [],
      };

      const metrics = calculateBlockMetrics(block, 1000n);

      expect(metrics.blockTimeSec).toBe(2);
    });

    it('calculates MGAS/s correctly', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 15000000n, // 15 MGAS
        timestamp: 1002n,
        transactions: [],
      };

      const metrics = calculateBlockMetrics(block, 1000n);

      expect(metrics.mgasPerSec).toBe(7.5); // 15 MGAS / 2 sec
    });

    it('calculates TPS correctly', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 2100000n,
        timestamp: 1002n,
        transactions: [
          { maxPriorityFeePerGas: 5n * GWEI, gas: 21000n },
          { maxPriorityFeePerGas: 5n * GWEI, gas: 21000n },
          { maxPriorityFeePerGas: 5n * GWEI, gas: 21000n },
          { maxPriorityFeePerGas: 5n * GWEI, gas: 21000n },
        ],
      };

      const metrics = calculateBlockMetrics(block, 1000n);

      expect(metrics.tps).toBe(2); // 4 tx / 2 sec
    });

    it('returns null throughput when no previous timestamp', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 15000000n,
        timestamp: 1002n,
        transactions: [],
      };

      const metrics = calculateBlockMetrics(block);

      expect(metrics.blockTimeSec).toBeNull();
      expect(metrics.mgasPerSec).toBeNull();
      expect(metrics.tps).toBeNull();
    });

    it('returns null throughput when block time is zero', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 15000000n,
        timestamp: 1000n,
        transactions: [],
      };

      const metrics = calculateBlockMetrics(block, 1000n);

      expect(metrics.blockTimeSec).toBe(0);
      expect(metrics.mgasPerSec).toBeNull();
      expect(metrics.tps).toBeNull();
    });
  });

  describe('total fees', () => {
    it('calculates total base fee correctly', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 1000000n,
        timestamp: 1000n,
        transactions: [],
      };

      const metrics = calculateBlockMetrics(block);

      // totalBaseFee = baseFee * gasUsed = 30 * 1000000 gwei
      expect(metrics.totalBaseFeeGwei).toBe(30000000);
    });
  });

  describe('transaction hashes only', () => {
    it('handles blocks with only transaction hashes', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 15000000n,
        timestamp: 1000n,
        transactions: [
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        ],
      };

      const metrics = calculateBlockMetrics(block);

      expect(metrics.minPriorityFeeGwei).toBe(0);
      expect(metrics.maxPriorityFeeGwei).toBe(0);
      expect(metrics.avgPriorityFeeGwei).toBeNull();
    });
  });
});
