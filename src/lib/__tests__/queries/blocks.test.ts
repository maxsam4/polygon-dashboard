// Tests for queries/blocks.ts

import { createBlockRow, sampleBlockRow, createBlock } from '../fixtures/blocks';

// Mock the db module before importing the functions
jest.mock('@/lib/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  getPool: jest.fn(() => ({
    connect: jest.fn(() => Promise.resolve({
      query: jest.fn(),
      release: jest.fn(),
    })),
  })),
}));

// Mock stats module
jest.mock('@/lib/queries/stats', () => ({
  getTableStats: jest.fn(),
}));

import { query, queryOne, getPool } from '@/lib/db';
import { getTableStats } from '@/lib/queries/stats';
import {
  getLatestBlocks,
  getBlockByNumber,
  getBlocksPaginated,
  getLowestBlockNumber,
  getHighestBlockNumber,
  insertBlock,
  insertBlocksBatch,
} from '@/lib/queries/blocks';

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;
const mockGetTableStats = getTableStats as jest.Mock;
// getPool is mocked but only used internally by the queries
void getPool;

describe('blocks queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getLatestBlocks', () => {
    it('queries blocks ordered by number descending', async () => {
      const rows = [
        createBlockRow({ block_number: '50000002' }),
        createBlockRow({ block_number: '50000001' }),
        createBlockRow({ block_number: '50000000' }),
      ];
      mockQuery.mockResolvedValueOnce(rows);

      const result = await getLatestBlocks(3);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('ORDER BY block_number DESC');
      expect(mockQuery.mock.calls[0][0]).toContain('LIMIT $2');
      expect(result).toHaveLength(3);
      expect(result[0].blockNumber).toBe(50000002n);
    });

    it('converts BlockRow to Block correctly', async () => {
      mockQuery.mockResolvedValueOnce([sampleBlockRow]);

      const result = await getLatestBlocks(1);

      expect(result[0]).toEqual(expect.objectContaining({
        blockNumber: BigInt(sampleBlockRow.block_number),
        timestamp: sampleBlockRow.timestamp,
        blockHash: sampleBlockRow.block_hash,
        parentHash: sampleBlockRow.parent_hash,
        gasUsed: BigInt(sampleBlockRow.gas_used),
        gasLimit: BigInt(sampleBlockRow.gas_limit),
        baseFeeGwei: sampleBlockRow.base_fee_gwei,
        txCount: sampleBlockRow.tx_count,
      }));
    });

    it('uses timestamp filter for performance', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await getLatestBlocks(20);

      expect(mockQuery.mock.calls[0][0]).toContain('timestamp >= $1');
    });
  });

  describe('getBlockByNumber', () => {
    it('returns block when found (fast path with timestamp estimate)', async () => {
      mockQueryOne.mockResolvedValueOnce(sampleBlockRow);

      const result = await getBlockByNumber(50000000n);

      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      // First param is block number, followed by estimated timestamp range
      const params = mockQueryOne.mock.calls[0][1];
      expect(params[0]).toBe('50000000');
      expect(params[1]).toBeInstanceOf(Date);
      expect(params[2]).toBeInstanceOf(Date);
      // Timestamp window should be ±1 day around estimate
      expect(params[2].getTime() - params[1].getTime()).toBe(2 * 86400 * 1000);
      expect(result?.blockNumber).toBe(50000000n);
    });

    it('falls back to unfiltered query when timestamp estimate misses', async () => {
      // First call (with timestamp) returns null, second (fallback) returns the row
      mockQueryOne.mockResolvedValueOnce(null);
      mockQueryOne.mockResolvedValueOnce(sampleBlockRow);

      const result = await getBlockByNumber(50000000n);

      expect(mockQueryOne).toHaveBeenCalledTimes(2);
      // Fallback call should only have block number param
      expect(mockQueryOne.mock.calls[1][1]).toEqual(['50000000']);
      expect(result?.blockNumber).toBe(50000000n);
    });

    it('returns null when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getBlockByNumber(99999999n);

      expect(result).toBeNull();
    });
  });

  describe('getBlocksPaginated', () => {
    it('uses cached stats for total count', async () => {
      mockGetTableStats.mockResolvedValueOnce({
        minValue: 45000000n,
        maxValue: 50000000n,
        totalCount: 5000001n,
      });
      mockQuery.mockResolvedValueOnce([sampleBlockRow]);

      const result = await getBlocksPaginated(1, 20);

      expect(mockGetTableStats).toHaveBeenCalledWith('blocks');
      expect(result.total).toBe(5000001);
    });

    it('calculates total from range when filters provided', async () => {
      mockGetTableStats.mockResolvedValueOnce({
        minValue: 45000000n,
        maxValue: 50000000n,
        totalCount: 5000001n,
      });
      mockQuery.mockResolvedValueOnce([sampleBlockRow]);

      const result = await getBlocksPaginated(1, 20, 49000000n, 49000099n);

      // effectiveTo - effectiveFrom + 1 = 100
      expect(result.total).toBe(100);
    });

    it('uses block range for pagination instead of OFFSET', async () => {
      mockGetTableStats.mockResolvedValueOnce({
        minValue: 45000000n,
        maxValue: 50000000n,
        totalCount: 5000001n,
      });
      mockQuery.mockResolvedValueOnce([sampleBlockRow]);

      await getBlocksPaginated(1, 20);

      expect(mockQuery.mock.calls[0][0]).toContain('block_number <=');
      expect(mockQuery.mock.calls[0][0]).toContain('block_number >=');
    });
  });

  describe('getLowestBlockNumber', () => {
    it('returns minValue from stats', async () => {
      mockGetTableStats.mockResolvedValueOnce({
        minValue: 45000000n,
        maxValue: 50000000n,
        totalCount: 5000001n,
      });

      const result = await getLowestBlockNumber();

      expect(result).toBe(45000000n);
    });

    it('returns null when no stats', async () => {
      mockGetTableStats.mockResolvedValueOnce(null);

      const result = await getLowestBlockNumber();

      expect(result).toBeNull();
    });

    it('returns null when minValue is null (no data)', async () => {
      mockGetTableStats.mockResolvedValueOnce({
        minValue: null,
        maxValue: null,
        totalCount: 0n,
      });

      const result = await getLowestBlockNumber();

      expect(result).toBeNull();
    });
  });

  describe('getHighestBlockNumber', () => {
    it('returns maxValue from stats', async () => {
      mockGetTableStats.mockResolvedValueOnce({
        minValue: 45000000n,
        maxValue: 50000000n,
        totalCount: 5000001n,
      });

      const result = await getHighestBlockNumber();

      expect(result).toBe(50000000n);
    });

    it('returns null when no stats', async () => {
      mockGetTableStats.mockResolvedValueOnce(null);

      const result = await getHighestBlockNumber();

      expect(result).toBeNull();
    });
  });

  describe('insertBlock', () => {
    it('inserts block with correct parameters', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const block = createBlock();

      await insertBlock(block);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO blocks');
      expect(mockQuery.mock.calls[0][0]).toContain('ON CONFLICT');
    });

    it('uses COALESCE for priority fees in upsert', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const block = createBlock();

      await insertBlock(block);

      expect(mockQuery.mock.calls[0][0]).toContain('COALESCE(EXCLUDED.avg_priority_fee_gwei');
    });
  });

  describe('insertBlocksBatch', () => {
    it('does nothing for empty array', async () => {
      await insertBlocksBatch([]);

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('inserts multiple blocks in single query', async () => {
      mockQuery.mockResolvedValueOnce([]); // INSERT
      mockQuery.mockResolvedValueOnce([]); // finality reconciliation UPDATE
      const blocks = [
        createBlock({ blockNumber: 100n }),
        createBlock({ blockNumber: 101n }),
      ];

      await insertBlocksBatch(blocks);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO blocks');
      expect(mockQuery.mock.calls[1][0]).toContain('UPDATE blocks'); // finality reconciliation
    });

    it('uses ON CONFLICT DO NOTHING for batch', async () => {
      mockQuery.mockResolvedValueOnce([]); // INSERT
      mockQuery.mockResolvedValueOnce([]); // finality reconciliation UPDATE
      const blocks = [createBlock()];

      await insertBlocksBatch(blocks);

      expect(mockQuery.mock.calls[0][0]).toContain('ON CONFLICT (timestamp, block_number) DO NOTHING');
    });
  });

});
