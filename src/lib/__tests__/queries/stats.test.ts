// Tests for queries/stats.ts

// Mock the db module
jest.mock('@/lib/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

import { query, queryOne } from '@/lib/db';
import {
  updateTableStats,
  getTableStats,
} from '@/lib/queries/stats';

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;

describe('stats queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('updateTableStats', () => {
    it('uses LEAST/GREATEST with COALESCE to maintain min/max (handles NULL)', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await updateTableStats('blocks', 45000000n, 50000000n, 100);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('LEAST(COALESCE(table_stats.min_value, EXCLUDED.min_value), EXCLUDED.min_value)');
      expect(mockQuery.mock.calls[0][0]).toContain('GREATEST(COALESCE(table_stats.max_value, EXCLUDED.max_value), EXCLUDED.max_value)');
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

    it('handles null min_value/max_value (no data)', async () => {
      mockQueryOne.mockResolvedValueOnce({
        table_name: 'blocks',
        min_value: null,
        max_value: null,
        total_count: '0',
        finalized_count: null,
        min_finalized: null,
        max_finalized: null,
        updated_at: new Date('2024-01-15T12:00:00Z'),
      });

      const result = await getTableStats('blocks');

      expect(result?.minValue).toBeNull();
      expect(result?.maxValue).toBeNull();
      expect(result?.totalCount).toBe(0n);
    });
  });

});
