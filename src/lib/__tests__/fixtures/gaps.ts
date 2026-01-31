// Gap tracking test fixtures

import type { Gap, DataCoverage, GapStats } from '@/lib/queries/gaps';

export const sampleBlockGap: Gap = {
  id: 1,
  gapType: 'block',
  startValue: 49999001n,
  endValue: 49999100n,
  gapSize: 100,
  source: 'live_poller',
  status: 'pending',
  createdAt: new Date('2024-01-15T11:00:00Z'),
  filledAt: null,
};

export const sampleMilestoneGap: Gap = {
  id: 2,
  gapType: 'milestone',
  startValue: 99000n,
  endValue: 99099n,
  gapSize: 100,
  source: 'milestone_poller',
  status: 'pending',
  createdAt: new Date('2024-01-15T11:00:00Z'),
  filledAt: null,
};

export const samplePriorityFeeGap: Gap = {
  id: 3,
  gapType: 'priority_fee',
  startValue: 49000000n,
  endValue: 49000999n,
  gapSize: 1000,
  source: 'gap_analyzer',
  status: 'pending',
  createdAt: new Date('2024-01-15T10:00:00Z'),
  filledAt: null,
};

export const sampleFilledGap: Gap = {
  ...sampleBlockGap,
  id: 4,
  status: 'filled',
  filledAt: new Date('2024-01-15T12:00:00Z'),
};

export const sampleFillingGap: Gap = {
  ...sampleBlockGap,
  id: 5,
  status: 'filling',
};

export function createGap(overrides: Partial<Gap> = {}): Gap {
  return { ...sampleBlockGap, ...overrides };
}

// Data coverage fixtures
export const sampleBlockCoverage: DataCoverage = {
  id: 'blocks',
  lowWaterMark: 45000000n,
  highWaterMark: 50000000n,
  lastAnalyzedAt: new Date('2024-01-15T11:55:00Z'),
  updatedAt: new Date('2024-01-15T12:00:00Z'),
};

export const sampleMilestoneCoverage: DataCoverage = {
  id: 'milestones',
  lowWaterMark: 90000n,
  highWaterMark: 100000n,
  lastAnalyzedAt: new Date('2024-01-15T11:55:00Z'),
  updatedAt: new Date('2024-01-15T12:00:00Z'),
};

export function createDataCoverage(overrides: Partial<DataCoverage> = {}): DataCoverage {
  return { ...sampleBlockCoverage, ...overrides };
}

// Gap stats fixtures
export const sampleGapStats: GapStats = {
  pendingCount: 5,
  totalPendingSize: 500,
  fillingCount: 1,
};

export function createGapStats(overrides: Partial<GapStats> = {}): GapStats {
  return { ...sampleGapStats, ...overrides };
}

// Row format for DB mocks
export interface GapRow {
  id: number;
  gap_type: string;
  start_value: string;
  end_value: string;
  gap_size: number;
  source: string;
  status: string;
  created_at: Date;
  filled_at: Date | null;
}

export const sampleGapRow: GapRow = {
  id: 1,
  gap_type: 'block',
  start_value: '49999001',
  end_value: '49999100',
  gap_size: 100,
  source: 'live_poller',
  status: 'pending',
  created_at: new Date('2024-01-15T11:00:00Z'),
  filled_at: null,
};

export function createGapRow(overrides: Partial<GapRow> = {}): GapRow {
  return { ...sampleGapRow, ...overrides };
}

export interface DataCoverageRow {
  id: string;
  low_water_mark: string;
  high_water_mark: string;
  last_analyzed_at: Date | null;
  updated_at: Date;
}

export const sampleDataCoverageRow: DataCoverageRow = {
  id: 'blocks',
  low_water_mark: '45000000',
  high_water_mark: '50000000',
  last_analyzed_at: new Date('2024-01-15T11:55:00Z'),
  updated_at: new Date('2024-01-15T12:00:00Z'),
};

export function createDataCoverageRow(overrides: Partial<DataCoverageRow> = {}): DataCoverageRow {
  return { ...sampleDataCoverageRow, ...overrides };
}
