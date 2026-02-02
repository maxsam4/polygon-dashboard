// Tests for queries/milestones.ts

import { sampleMilestoneRow, createMilestone } from '../fixtures/milestones';

// Mock the db module
jest.mock('@/lib/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

// Mock stats module
jest.mock('@/lib/queries/stats', () => ({
  getTableStats: jest.fn(),
}));

import { query, queryOne } from '@/lib/db';
import { getTableStats } from '@/lib/queries/stats';
import {
  getLatestMilestone,
  insertMilestone,
  insertMilestonesBatch,
  getLowestSequenceId,
  getHighestSequenceId,
  reconcileBlocksForMilestones,
  getMilestonesPaginated,
} from '@/lib/queries/milestones';

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;
const mockGetTableStats = getTableStats as jest.Mock;

describe('milestones queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getLatestMilestone', () => {
    it('returns the most recent milestone', async () => {
      mockQueryOne.mockResolvedValueOnce(sampleMilestoneRow);

      const result = await getLatestMilestone();

      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      expect(mockQueryOne.mock.calls[0][0]).toContain('ORDER BY milestone_id DESC');
      expect(mockQueryOne.mock.calls[0][0]).toContain('LIMIT 1');
      expect(result?.milestoneId).toBe(50000100n);
    });

    it('returns null when no milestones exist', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getLatestMilestone();

      expect(result).toBeNull();
    });

    it('converts MilestoneRow to Milestone correctly', async () => {
      mockQueryOne.mockResolvedValueOnce(sampleMilestoneRow);

      const result = await getLatestMilestone();

      expect(result).toEqual(expect.objectContaining({
        milestoneId: BigInt(sampleMilestoneRow.milestone_id),
        sequenceId: sampleMilestoneRow.sequence_id,
        startBlock: BigInt(sampleMilestoneRow.start_block),
        endBlock: BigInt(sampleMilestoneRow.end_block),
        hash: sampleMilestoneRow.hash,
        proposer: sampleMilestoneRow.proposer,
        timestamp: sampleMilestoneRow.timestamp,
      }));
    });
  });

  describe('insertMilestone', () => {
    it('inserts milestone with correct parameters', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const milestone = createMilestone();

      await insertMilestone(milestone);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO milestones');
      expect(mockQuery.mock.calls[0][1]).toEqual([
        '50000100',
        100000,
        '50000001',
        '50000100',
        milestone.hash,
        milestone.proposer,
        milestone.timestamp,
      ]);
    });

    it('uses ON CONFLICT DO NOTHING', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const milestone = createMilestone();

      await insertMilestone(milestone);

      expect(mockQuery.mock.calls[0][0]).toContain('ON CONFLICT (milestone_id) DO NOTHING');
    });
  });

  describe('insertMilestonesBatch', () => {
    it('does nothing for empty array', async () => {
      await insertMilestonesBatch([]);

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('uses UNNEST for efficient batch insert', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const milestones = [
        createMilestone({ sequenceId: 100 }),
        createMilestone({ sequenceId: 101 }),
      ];

      await insertMilestonesBatch(milestones);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('UNNEST');
      expect(mockQuery.mock.calls[0][0]).toContain('ON CONFLICT (milestone_id) DO NOTHING');
    });
  });

  describe('getLowestSequenceId', () => {
    it('returns minimum sequence_id', async () => {
      mockQueryOne.mockResolvedValueOnce({ min: 90000 });

      const result = await getLowestSequenceId();

      expect(mockQueryOne.mock.calls[0][0]).toContain('MIN(sequence_id)');
      expect(result).toBe(90000);
    });

    it('returns null when no milestones', async () => {
      mockQueryOne.mockResolvedValueOnce({ min: null });

      const result = await getLowestSequenceId();

      expect(result).toBeNull();
    });
  });

  describe('getHighestSequenceId', () => {
    it('returns maximum sequence_id', async () => {
      mockQueryOne.mockResolvedValueOnce({ max: 100000 });

      const result = await getHighestSequenceId();

      expect(mockQueryOne.mock.calls[0][0]).toContain('MAX(sequence_id)');
      expect(result).toBe(100000);
    });
  });

  describe('reconcileBlocksForMilestones', () => {
    it('returns 0 for empty array', async () => {
      const result = await reconcileBlocksForMilestones([]);

      expect(result).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('processes multiple milestones efficiently', async () => {
      mockQuery.mockResolvedValueOnce([{ count: '200' }]);
      const milestones = [
        createMilestone({ startBlock: 100n, endBlock: 199n }),
        createMilestone({ startBlock: 200n, endBlock: 299n }),
      ];

      const result = await reconcileBlocksForMilestones(milestones);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(result).toBe(200);
    });
  });

  describe('getMilestonesPaginated', () => {
    it('uses cached stats for total count', async () => {
      mockGetTableStats.mockResolvedValueOnce({
        totalCount: 1000n,
      });
      mockQuery.mockResolvedValueOnce([
        { ...sampleMilestoneRow, blocks_in_db: '100', avg_finality_time: 25.5 },
      ]);

      const result = await getMilestonesPaginated(1, 20);

      expect(mockGetTableStats).toHaveBeenCalledWith('milestones');
      expect(result.total).toBe(1000);
    });

    it('includes block stats in result', async () => {
      mockGetTableStats.mockResolvedValueOnce({ totalCount: 100n });
      mockQuery.mockResolvedValueOnce([
        { ...sampleMilestoneRow, blocks_in_db: '100', avg_finality_time: 25.5 },
      ]);

      const result = await getMilestonesPaginated(1, 20);

      expect(result.milestones[0].blocksInDb).toBe(100);
      expect(result.milestones[0].avgFinalityTime).toBe(25.5);
    });
  });
});
