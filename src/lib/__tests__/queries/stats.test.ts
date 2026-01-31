// Tests for queries/stats.ts

// Mock the db module
jest.mock('@/lib/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

import { query, queryOne } from '@/lib/db';
import {
  updateTableStats,
  updateFinalityStats,
  getTableStats,
  getPendingUnfinalizedCount,
  refreshFinalityStats,
  refreshTableStats,
} from '@/lib/queries/stats';

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;

describe('stats queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('updateTableStats', () => {
    it('uses LEAST/GREATEST to maintain min/max', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await updateTableStats('blocks', 45000000n, 50000000n, 100);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('LEAST(table_stats.min_value, EXCLUDED.min_value)');
      expect(mockQuery.mock.calls[0][0]).toContain('GREATEST(table_stats.max_value, EXCLUDED.max_value)');
    });

    it('increments total_count', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await updateTableStats('blocks', 100n, 200n, 50);

      expect(mockQuery.mock.calls[0][0]).toContain('total_count = table_stats.total_count + $5');
      expect(mockQuery.mock.calls[0][1]).toContain(50);
    });

    it('defaults increment to 1', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await updateTableStats('blocks', 100n, 100n);

      // incrementCount appears twice: once for insert, once for update
      expect(mockQuery.mock.calls[0][1]).toContain(1);
    });

    it('supports both blocks and milestones tables', async () => {
      mockQuery.mockResolvedValue([]);

      await updateTableStats('blocks', 100n, 200n);
      await updateTableStats('milestones', 50n, 100n);

      expect(mockQuery.mock.calls[0][1][0]).toBe('blocks');
      expect(mockQuery.mock.calls[1][1][0]).toBe('milestones');
    });
  });

  describe('updateFinalityStats', () => {
    it('updates finality fields for blocks table', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await updateFinalityStats(1000n, 45000000n, 50000000n);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('finalized_count = $1');
      expect(mockQuery.mock.calls[0][0]).toContain('min_finalized = $2');
      expect(mockQuery.mock.calls[0][0]).toContain('max_finalized = $3');
      expect(mockQuery.mock.calls[0][0]).toContain("table_name = 'blocks'");
      expect(mockQuery.mock.calls[0][1]).toEqual(['1000', '45000000', '50000000']);
    });

    it('handles null min/max finalized', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await updateFinalityStats(0n, null, null);

      expect(mockQuery.mock.calls[0][1]).toEqual(['0', null, null]);
    });
  });

  describe('getTableStats', () => {
    it('returns stats when found', async () => {
      mockQueryOne.mockResolvedValueOnce({
        table_name: 'blocks',
        min_value: '45000000',
        max_value: '50000000',
        total_count: '5000001',
        finalized_count: '4999000',
        min_finalized: '45000000',
        max_finalized: '49999000',
        updated_at: new Date('2024-01-15T12:00:00Z'),
      });

      const result = await getTableStats('blocks');

      expect(mockQueryOne.mock.calls[0][1]).toEqual(['blocks']);
      expect(result).toEqual({
        minValue: 45000000n,
        maxValue: 50000000n,
        totalCount: 5000001n,
        finalizedCount: 4999000n,
        minFinalized: 45000000n,
        maxFinalized: 49999000n,
        updatedAt: expect.any(Date),
      });
    });

    it('returns null when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getTableStats('blocks');

      expect(result).toBeNull();
    });

    it('handles null finality fields', async () => {
      mockQueryOne.mockResolvedValueOnce({
        table_name: 'milestones',
        min_value: '90000',
        max_value: '100000',
        total_count: '10001',
        finalized_count: null,
        min_finalized: null,
        max_finalized: null,
        updated_at: new Date(),
      });

      const result = await getTableStats('milestones');

      expect(result?.finalizedCount).toBeNull();
      expect(result?.minFinalized).toBeNull();
      expect(result?.maxFinalized).toBeNull();
    });
  });

  describe('getPendingUnfinalizedCount', () => {
    it('counts unfinalized blocks with timestamp filter', async () => {
      mockQueryOne.mockResolvedValueOnce({ count: '500' });

      const result = await getPendingUnfinalizedCount();

      expect(mockQueryOne.mock.calls[0][0]).toContain('finalized = false');
      expect(mockQueryOne.mock.calls[0][0]).toContain('timestamp >= $1');
      expect(result).toBe(500);
    });

    it('returns 0 when no unfinalized blocks', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getPendingUnfinalizedCount();

      expect(result).toBe(0);
    });
  });

  describe('refreshFinalityStats', () => {
    it('performs full table scan to get finality stats', async () => {
      mockQueryOne.mockResolvedValueOnce({
        finalized_count: '4999000',
        min_finalized: '45000000',
        max_finalized: '49999000',
      });
      mockQuery.mockResolvedValueOnce([]);

      await refreshFinalityStats();

      // First call is the SELECT
      expect(mockQueryOne.mock.calls[0][0]).toContain("COUNT(*) FILTER (WHERE finalized = true)");
      expect(mockQueryOne.mock.calls[0][0]).toContain("MIN(block_number) FILTER (WHERE finalized = true)");
      expect(mockQueryOne.mock.calls[0][0]).toContain("MAX(block_number) FILTER (WHERE finalized = true)");
    });

    it('updates table_stats with refreshed values', async () => {
      mockQueryOne.mockResolvedValueOnce({
        finalized_count: '1000',
        min_finalized: '100',
        max_finalized: '1100',
      });
      mockQuery.mockResolvedValueOnce([]);

      await refreshFinalityStats();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('UPDATE table_stats');
    });
  });

  describe('refreshTableStats', () => {
    it('refreshes blocks stats with finality info', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await refreshTableStats('blocks');

      expect(mockQuery.mock.calls[0][0]).toContain("'blocks'");
      expect(mockQuery.mock.calls[0][0]).toContain('MIN(block_number)');
      expect(mockQuery.mock.calls[0][0]).toContain('MAX(block_number)');
      expect(mockQuery.mock.calls[0][0]).toContain("COUNT(*) FILTER (WHERE finalized = true)");
    });

    it('refreshes milestones stats without finality', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await refreshTableStats('milestones');

      expect(mockQuery.mock.calls[0][0]).toContain("'milestones'");
      expect(mockQuery.mock.calls[0][0]).toContain('MIN(sequence_id)');
      expect(mockQuery.mock.calls[0][0]).toContain('MAX(sequence_id)');
      expect(mockQuery.mock.calls[0][0]).not.toContain('finalized');
    });

    it('uses ON CONFLICT for upsert', async () => {
      mockQuery.mockResolvedValue([]);

      await refreshTableStats('blocks');
      await refreshTableStats('milestones');

      expect(mockQuery.mock.calls[0][0]).toContain('ON CONFLICT (table_name) DO UPDATE');
      expect(mockQuery.mock.calls[1][0]).toContain('ON CONFLICT (table_name) DO UPDATE');
    });
  });
});
