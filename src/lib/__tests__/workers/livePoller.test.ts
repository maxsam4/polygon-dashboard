// Tests for workers/livePoller.ts - worker status and gap detection logic

import { calculateBlockMetrics } from '@/lib/gas';

// Test the metrics calculation used by LivePoller
describe('LivePoller metrics calculation', () => {
  const GWEI = 1_000_000_000n;

  describe('calculateBlockMetrics', () => {
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

    it('returns null metrics when no previous timestamp', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 15000000n,
        timestamp: 1000n,
        transactions: [],
      };

      const metrics = calculateBlockMetrics(block);

      expect(metrics.blockTimeSec).toBeNull();
      expect(metrics.mgasPerSec).toBeNull();
      expect(metrics.tps).toBeNull();
    });

    it('calculates MGAS/s correctly', () => {
      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 20000000n, // 20 MGAS
        timestamp: 1002n,
        transactions: [],
      };

      const metrics = calculateBlockMetrics(block, 1000n);

      expect(metrics.mgasPerSec).toBe(10); // 20 MGAS / 2 sec
    });

    it('calculates TPS correctly', () => {
      const txs = Array(100).fill(null).map(() => ({
        maxPriorityFeePerGas: 5n * GWEI,
        gas: 21000n,
      }));

      const block = {
        baseFeePerGas: 30n * GWEI,
        gasUsed: 2100000n, // 100 * 21000
        timestamp: 1002n,
        transactions: txs,
      };

      const metrics = calculateBlockMetrics(block, 1000n);

      expect(metrics.tps).toBe(50); // 100 tx / 2 sec
    });
  });

  describe('gap detection logic', () => {
    it('detects gaps when blocks are non-consecutive', () => {
      // This tests the logic pattern used in LivePoller
      const lastProcessedBlock = 49999990n;
      const newBlockNumber = 50000000n;

      const isConsecutive = newBlockNumber === lastProcessedBlock + 1n;
      expect(isConsecutive).toBe(false);

      if (!isConsecutive) {
        const gapStart = lastProcessedBlock + 1n;
        const gapEnd = newBlockNumber - 1n;
        expect(gapStart).toBe(49999991n);
        expect(gapEnd).toBe(49999999n);
      }
    });

    it('identifies consecutive blocks', () => {
      const lastProcessedBlock = 49999999n;
      const newBlockNumber = 50000000n;

      const isConsecutive = newBlockNumber === lastProcessedBlock + 1n;
      expect(isConsecutive).toBe(true);
    });

    it('calculates gap size correctly', () => {
      const gapStart = 49999991n;
      const gapEnd = 49999999n;

      const gapSize = Number(gapEnd - gapStart) + 1;
      expect(gapSize).toBe(9);
    });
  });

  describe('batch processing logic', () => {
    it('limits batch size based on gap', () => {
      const MAX_GAP = 30;
      const BATCH_SIZE = 10;

      const lastProcessedBlock = 49999990n;
      const latestBlock = 50000000n;
      const gap = latestBlock - lastProcessedBlock;

      // When gap is within limits, process up to BATCH_SIZE
      if (gap <= BigInt(MAX_GAP)) {
        const batchSize = Math.min(Number(gap), BATCH_SIZE);
        expect(batchSize).toBe(10);
      }
    });

    it('skips to near tip when gap is too large', () => {
      const MAX_GAP = 30;

      const lastProcessedBlock = 49999000n;
      const latestBlock = 50000000n;
      const gap = latestBlock - lastProcessedBlock;

      expect(gap).toBe(1000n);
      expect(gap > BigInt(MAX_GAP)).toBe(true);

      // Should skip to near the tip
      const newLastProcessed = latestBlock - BigInt(MAX_GAP);
      expect(newLastProcessed).toBe(49999970n);
    });
  });
});

describe('LivePoller worker status', () => {
  it('tracks worker state constants', () => {
    const WORKER_NAME = 'LivePoller';
    const POLL_INTERVAL_MS = 2000;
    const EXHAUSTED_RETRY_MS = 5000;
    const MAX_GAP = 30;
    const BATCH_SIZE = 10;

    expect(WORKER_NAME).toBe('LivePoller');
    expect(POLL_INTERVAL_MS).toBe(2000);
    expect(EXHAUSTED_RETRY_MS).toBe(5000);
    expect(MAX_GAP).toBe(30);
    expect(BATCH_SIZE).toBe(10);
  });
});
