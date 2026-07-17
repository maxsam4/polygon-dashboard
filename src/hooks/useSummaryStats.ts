'use client';

import { useState, useEffect, useCallback } from 'react';
import type { SummaryStats } from '@/lib/types';

export type StatsTimeRange = '1H' | '6H' | '1D' | '1W' | '1M' | '1Y' | 'YTD' | 'ALL';

export const STATS_TIME_RANGES: StatsTimeRange[] = [
  '1H',
  '6H',
  '1D',
  '1W',
  '1M',
  '1Y',
  'YTD',
  'ALL',
];

const POLL_INTERVAL_MS: Record<StatsTimeRange, number> = {
  '1H': 15_000,
  '6H': 30_000,
  '1D': 60_000,
  '1W': 5 * 60_000,
  '1M': 5 * 60_000,
  '1Y': 10 * 60_000,
  YTD: 10 * 60_000,
  ALL: 10 * 60_000,
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const FIXED_RANGE_MS: Partial<Record<StatsTimeRange, number>> = {
  '1H': HOUR_MS,
  '6H': 6 * HOUR_MS,
  '1D': DAY_MS,
  '1W': 7 * DAY_MS,
  '1M': 30 * DAY_MS,
  '1Y': 365 * DAY_MS,
};

function fromSecForRange(range: StatsTimeRange, nowMs: number): number {
  if (range === 'ALL') {
    return 0; // server clamps to earliest data
  }
  if (range === 'YTD') {
    return Math.floor(Date.UTC(new Date(nowMs).getUTCFullYear(), 0, 1) / 1000);
  }
  const rangeMs = FIXED_RANGE_MS[range] ?? DAY_MS;
  return Math.floor((nowMs - rangeMs) / 1000);
}

export function useSummaryStats(): {
  timeRange: StatsTimeRange;
  setTimeRange: (r: StatsTimeRange) => void;
  stats: SummaryStats | null;
  loading: boolean;
  error: string | null;
} {
  const [timeRange, setTimeRange] = useState<StatsTimeRange>('1D');
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const nowMs = Date.now();
      const to = Math.floor(nowMs / 1000);
      const from = fromSecForRange(timeRange, nowMs);

      const res = await fetch(`/api/stats?from=${from}&to=${to}`);
      if (!res.ok) {
        throw new Error('Failed to fetch summary stats');
      }

      const data: SummaryStats = await res.json();
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS[timeRange]);
    return () => clearInterval(interval);
  }, [fetchData, timeRange]);

  return {
    timeRange,
    setTimeRange,
    stats,
    loading,
    error,
  };
}
