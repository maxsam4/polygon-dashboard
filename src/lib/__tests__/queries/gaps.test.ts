// Tests for queries/gaps.ts

import { createGapRow, createDataCoverageRow, sampleGapRow } from '../fixtures/gaps';

// Mock the db module
jest.mock('@/lib/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

import { query, queryOne } from '@/lib/db';
import {
  insertGap,
  getPendingGaps,
  claimGap,
  markGapFilled,
  shrinkGap,
  releaseGap,
  getDataCoverage,
  upsertDataCoverage,
  updateWaterMarks,
  updateLastAnalyzedAt,
  getGapStats,
} from '@/lib/queries/gaps';

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;

describe('gaps queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('insertGap', () => {
    it('inserts gap with correct parameters', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await insertGap('block', 100n, 199n, 'test_source');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO gaps');
      expect(mockQuery.mock.calls[0][1]).toEqual(['block', '100', '199', 'test_source']);
    });

    it('uses ON CONFLICT DO NOTHING for idempotency', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await insertGap('block', 100n, 199n, 'test');

      expect(mockQuery.mock.calls[0][0]).toContain('ON CONFLICT (gap_type, start_value, end_value) DO NOTHING');
    });

    it('supports different gap types', async () => {
      mockQuery.mockResolvedValue([]);

      await insertGap('block', 100n, 199n, 'test');
      await insertGap('milestone', 50n, 99n, 'test');
      await insertGap('priority_fee', 1000n, 1999n, 'test');

      expect(mockQuery.mock.calls[0][1][0]).toBe('block');
      expect(mockQuery.mock.calls[1][1][0]).toBe('milestone');
      expect(mockQuery.mock.calls[2][1][0]).toBe('priority_fee');
    });
  });

  describe('getPendingGaps', () => {
    it('returns pending gaps ordered by end_value DESC', async () => {
      const rows = [
        createGapRow({ id: 1, end_value: '200' }),
        createGapRow({ id: 2, end_value: '100' }),
      ];
      mockQuery.mockResolvedValueOnce(rows);

      const result = await getPendingGaps('block', 10);

      expect(mockQuery.mock.calls[0][0]).toContain("status = 'pending'");
      expect(mockQuery.mock.calls[0][0]).toContain('ORDER BY end_value DESC');
      expect(mockQuery.mock.calls[0][1]).toEqual(['block', 10]);
      expect(result).toHaveLength(2);
    });

    it('converts GapRow to Gap correctly', async () => {
      mockQuery.mockResolvedValueOnce([sampleGapRow]);

      const result = await getPendingGaps('block', 1);

      expect(result[0]).toEqual(expect.objectContaining({
        id: sampleGapRow.id,
        gapType: sampleGapRow.gap_type,
        startValue: BigInt(sampleGapRow.start_value),
        endValue: BigInt(sampleGapRow.end_value),
        gapSize: sampleGapRow.gap_size,
        source: sampleGapRow.source,
        status: sampleGapRow.status,
      }));
    });
  });

  describe('claimGap', () => {
    it('returns true when gap claimed successfully', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 1 }]);

      const result = await claimGap(1);

      expect(mockQuery.mock.calls[0][0]).toContain("SET status = 'filling'");
      expect(mockQuery.mock.calls[0][0]).toContain("status = 'pending'");
      expect(result).toBe(true);
    });

    it('returns false when gap not available', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await claimGap(999);

      expect(result).toBe(false);
    });
  });

  describe('markGapFilled', () => {
    it('sets status to filled with timestamp', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await markGapFilled(1);

      expect(mockQuery.mock.calls[0][0]).toContain("status = 'filled'");
      expect(mockQuery.mock.calls[0][0]).toContain('filled_at = NOW()');
      expect(mockQuery.mock.calls[0][1]).toEqual([1]);
    });
  });

  describe('shrinkGap', () => {
    it('updates gap range when newStart <= newEnd', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await shrinkGap(1, 150n, 199n);

      expect(mockQuery.mock.calls[0][0]).toContain('start_value = $1');
      expect(mockQuery.mock.calls[0][0]).toContain('end_value = $2');
      expect(mockQuery.mock.calls[0][0]).toContain("status = 'pending'");
      expect(mockQuery.mock.calls[0][1]).toEqual(['150', '199', 1]);
    });

    it('marks gap as filled when newStart > newEnd', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await shrinkGap(1, 200n, 150n);

      expect(mockQuery.mock.calls[0][0]).toContain("status = 'filled'");
    });
  });

  describe('releaseGap', () => {
    it('sets status back to pending', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await releaseGap(1);

      expect(mockQuery.mock.calls[0][0]).toContain("status = 'pending'");
      expect(mockQuery.mock.calls[0][1]).toEqual([1]);
    });
  });

  describe('getDataCoverage', () => {
    it('returns coverage when found', async () => {
      mockQueryOne.mockResolvedValueOnce(createDataCoverageRow());

      const result = await getDataCoverage('blocks');

      expect(mockQueryOne.mock.calls[0][1]).toEqual(['blocks']);
      expect(result).toEqual(expect.objectContaining({
        id: 'blocks',
        lowWaterMark: 45000000n,
        highWaterMark: 50000000n,
      }));
    });

    it('returns null when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getDataCoverage('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('upsertDataCoverage', () => {
    it('uses LEAST/GREATEST to expand range', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await upsertDataCoverage('blocks', 40000000n, 55000000n);

      expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO data_coverage');
      expect(mockQuery.mock.calls[0][0]).toContain('LEAST(data_coverage.low_water_mark, EXCLUDED.low_water_mark)');
      expect(mockQuery.mock.calls[0][0]).toContain('GREATEST(data_coverage.high_water_mark, EXCLUDED.high_water_mark)');
      expect(mockQuery.mock.calls[0][1]).toEqual(['blocks', '40000000', '55000000']);
    });
  });

  describe('updateWaterMarks', () => {
    it('explicitly sets water marks', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await updateWaterMarks('blocks', 45000000n, 50000000n);

      expect(mockQuery.mock.calls[0][0]).toContain('low_water_mark = $1');
      expect(mockQuery.mock.calls[0][0]).toContain('high_water_mark = $2');
      expect(mockQuery.mock.calls[0][1]).toEqual(['45000000', '50000000', 'blocks']);
    });
  });

  describe('updateLastAnalyzedAt', () => {
    it('sets last_analyzed_at to NOW()', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await updateLastAnalyzedAt('blocks');

      expect(mockQuery.mock.calls[0][0]).toContain('last_analyzed_at = NOW()');
      expect(mockQuery.mock.calls[0][1]).toEqual(['blocks']);
    });
  });

  describe('getGapStats', () => {
    it('returns aggregated gap statistics', async () => {
      mockQueryOne.mockResolvedValueOnce({
        pending_count: '5',
        total_pending_size: '500',
        filling_count: '1',
      });

      const result = await getGapStats('block');

      expect(mockQueryOne.mock.calls[0][0]).toContain("COUNT(*) FILTER (WHERE status = 'pending')");
      expect(mockQueryOne.mock.calls[0][0]).toContain("SUM(gap_size) FILTER (WHERE status = 'pending')");
      expect(mockQueryOne.mock.calls[0][0]).toContain("COUNT(*) FILTER (WHERE status = 'filling')");
      expect(result).toEqual({
        pendingCount: 5,
        totalPendingSize: 500,
        fillingCount: 1,
      });
    });

    it('returns zeros when no gaps', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getGapStats('block');

      expect(result).toEqual({
        pendingCount: 0,
        totalPendingSize: 0,
        fillingCount: 0,
      });
    });
  });
});
