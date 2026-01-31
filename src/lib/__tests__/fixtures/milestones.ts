// Milestone test fixtures

import type { Milestone, MilestoneWithStats } from '@/lib/types';

export const sampleMilestone: Milestone = {
  milestoneId: 50000100n,
  sequenceId: 100000,
  startBlock: 50000001n,
  endBlock: 50000100n,
  hash: '0xmilestone1234567890abcdef1234567890abcdef1234567890abcdef12345678',
  proposer: '0xProposer1234567890abcdef1234567890abcdef',
  timestamp: new Date('2024-01-15T12:00:30Z'),
};

export const sampleMilestoneWithStats: MilestoneWithStats = {
  ...sampleMilestone,
  blocksInDb: 100,
  avgFinalityTime: 25.5,
};

export function createMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return { ...sampleMilestone, ...overrides };
}

export function createMilestoneBatch(
  count: number,
  startSequenceId = 100000,
  blocksPerMilestone = 100
): Milestone[] {
  const milestones: Milestone[] = [];
  let currentStartBlock = 50000001n;

  for (let i = 0; i < count; i++) {
    const sequenceId = startSequenceId + i;
    const startBlock = currentStartBlock;
    const endBlock = startBlock + BigInt(blocksPerMilestone) - 1n;

    milestones.push(createMilestone({
      milestoneId: endBlock,
      sequenceId,
      startBlock,
      endBlock,
      hash: `0xmilestone${sequenceId.toString().padStart(58, '0')}`,
      timestamp: new Date(new Date('2024-01-15T12:00:30Z').getTime() + i * 30000),
    }));

    currentStartBlock = endBlock + 1n;
  }

  return milestones;
}

// Row format for DB mocks
export interface MilestoneRow {
  milestone_id: string;
  sequence_id: number;
  start_block: string;
  end_block: string;
  hash: string;
  proposer: string | null;
  timestamp: Date;
}

export const sampleMilestoneRow: MilestoneRow = {
  milestone_id: '50000100',
  sequence_id: 100000,
  start_block: '50000001',
  end_block: '50000100',
  hash: '0xmilestone1234567890abcdef1234567890abcdef1234567890abcdef12345678',
  proposer: '0xProposer1234567890abcdef1234567890abcdef',
  timestamp: new Date('2024-01-15T12:00:30Z'),
};

export function createMilestoneRow(overrides: Partial<MilestoneRow> = {}): MilestoneRow {
  return { ...sampleMilestoneRow, ...overrides };
}
