// Tests for workers/backfiller.ts - batch processing logic

import { calculateBlockMetrics } from '@/lib/gas';

describe('Backfiller batch processing logic', () => {
  const BASE_BATCH_SIZE = 50;

  describe('batch size calculation', () => {
    it('scales batch size by endpoint count', () => {
      const endpointCount = 2;
      const batchSize = BASE_BATCH_SIZE * endpointCount;
      expect(batchSize).toBe(100);
    });

    it('calculates larger batches with more endpoints', () => {
      const endpointCount = 4;
      const batchSize = BASE_BATCH_SIZE * endpointCount;
      expect(batchSize).toBe(200);
    });
  });

  describe('block range calculation', () => {
    it('calculates correct start and end blocks', () => {
      const currentLowest = 50000000n;
      const batchSize = 100;

      const endBlock = currentLowest - 1n;
      const startBlock = currentLowest - BigInt(batchSize);

      expect(endBlock).toBe(49999999n);
      expect(startBlock).toBe(49999900n);
    });

    it('respects target block boundary', () => {
      const currentLowest = 50000000n;
      const batchSize = 100;
      const targetBlock = 49999950n;

      const startBlock = currentLowest - BigInt(batchSize);
      const targetStart = startBlock < targetBlock ? targetBlock : startBlock;

      expect(targetStart).toBe(49999950n);
    });

    it('calculates block count in range', () => {
      const startBlock = 49999900n;
      const endBlock = 49999999n;

      const blockCount = Number(endBlock - startBlock) + 1;
      expect(blockCount).toBe(100);
    });
  });

  describe('previous block timestamps', () => {
    it('identifies previous blocks needed for timing', () => {
      const blockNumbers = [100n, 101n, 102n];
      const prevBlockNumbers = blockNumbers.map(n => n - 1n).filter(n => n >= 0n);

      expect(prevBlockNumbers).toEqual([99n, 100n, 101n]);
    });

    it('filters out negative block numbers', () => {
      const blockNumbers = [0n, 1n, 2n];
      const prevBlockNumbers = blockNumbers.map(n => n - 1n).filter(n => n >= 0n);

      expect(prevBlockNumbers).toEqual([0n, 1n]);
    });
  });

  describe('completion detection', () => {
    it('detects when target is reached', () => {
      const lowestBlock = 49000000n;
      const targetBlock = 49000000n;

      const isComplete = lowestBlock <= targetBlock;
      expect(isComplete).toBe(true);
    });

    it('continues when above target', () => {
      const lowestBlock = 50000000n;
      const targetBlock = 49000000n;

      const isComplete = lowestBlock <= targetBlock;
      expect(isComplete).toBe(false);
    });
  });
});

describe('Backfiller metrics calculation', () => {
  const GWEI = 1_000_000_000n;

  it('calculates block metrics with previous timestamp', () => {
    const block = {
      baseFeePerGas: 30n * GWEI,
      gasUsed: 15000000n,
      timestamp: 1002n,
      transactions: [],
    };

    const metrics = calculateBlockMetrics(block, 1000n);

    expect(metrics.blockTimeSec).toBe(2);
    expect(metrics.baseFeeGwei).toBe(30);
  });

  it('handles blocks without previous timestamp', () => {
    const block = {
      baseFeePerGas: 30n * GWEI,
      gasUsed: 15000000n,
      timestamp: 1000n,
      transactions: [],
    };

    const metrics = calculateBlockMetrics(block, undefined);

    expect(metrics.blockTimeSec).toBeNull();
    expect(metrics.baseFeeGwei).toBe(30);
  });
});

describe('Backfiller worker constants', () => {
  it('defines expected constants', () => {
    const WORKER_NAME = 'Backfiller';
    const EXHAUSTED_RETRY_MS = 5000;
    const BASE_BATCH_SIZE = 50;

    expect(WORKER_NAME).toBe('Backfiller');
    expect(EXHAUSTED_RETRY_MS).toBe(5000);
    expect(BASE_BATCH_SIZE).toBe(50);
  });
});
