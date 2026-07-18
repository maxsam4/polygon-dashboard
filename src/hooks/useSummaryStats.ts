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

/** What the user selected: a rolling preset, a calendar month, or explicit bounds. */
export type StatsSelection =
  | { kind: 'preset'; range: StatsTimeRange }
  | { kind: 'month'; year: number; month: number } // month: 1-12, UTC calendar month
  | { kind: 'custom'; fromSec: number; toSec: number };

const PRESET_POLL_INTERVAL_MS: Record<StatsTimeRange, number> = {
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

function fromSecForPreset(range: StatsTimeRange, nowMs: number): number {
  if (range === 'ALL') {
    return 0; // server clamps to earliest data
  }
  if (range === 'YTD') {
    return Math.floor(Date.UTC(new Date(nowMs).getUTCFullYear(), 0, 1) / 1000);
  }
  const rangeMs = FIXED_RANGE_MS[range] ?? DAY_MS;
  return Math.floor((nowMs - rangeMs) / 1000);
}

function boundsForSelection(sel: StatsSelection, nowMs: number): { from: number; to: number } {
  if (sel.kind === 'preset') {
    return { from: fromSecForPreset(sel.range, nowMs), to: Math.floor(nowMs / 1000) };
  }
  if (sel.kind === 'month') {
    return {
      from: Math.floor(Date.UTC(sel.year, sel.month - 1, 1) / 1000),
      to: Math.floor(Date.UTC(sel.year, sel.month, 1) / 1000),
    };
  }
  return { from: sel.fromSec, to: sel.toSec };
}

function pollIntervalMs(sel: StatsSelection, nowMs: number): number {
  if (sel.kind === 'preset') return PRESET_POLL_INTERVAL_MS[sel.range];
  // Historical windows never change; only keep polling if the window is still open
  const { to } = boundsForSelection(sel, nowMs);
  return to * 1000 >= nowMs - 2 * 60_000 ? 60_000 : 10 * 60_000;
}

export function useSummaryStats(): {
  selection: StatsSelection;
  setSelection: (s: StatsSelection) => void;
  stats: SummaryStats | null;
  loading: boolean;
  error: string | null;
} {
  const [selection, setSelection] = useState<StatsSelection>({ kind: 'preset', range: '1D' });
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const nowMs = Date.now();
      const { from, to } = boundsForSelection(selection, nowMs);

      const res = await fetch(`/api/stats?from=${from}&to=${Math.min(to, Math.floor(nowMs / 1000))}`);
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
  }, [selection]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(fetchData, pollIntervalMs(selection, Date.now()));
    return () => clearInterval(interval);
  }, [fetchData, selection]);

  return {
    selection,
    setSelection,
    stats,
    loading,
    error,
  };
}
