'use client';

import { useState, useEffect, useCallback } from 'react';
import type { EndpointStat, MethodStat, RpcTimeSeriesPoint } from '@/lib/queries/rpcStats';

type TimeRange = '1H' | '6H' | '1D' | '1W' | '1M';

const POLL_INTERVAL_MS: Record<TimeRange, number> = {
  '1H': 30_000,
  '6H': 60_000,
  '1D': 5 * 60_000,
  '1W': 15 * 60_000,
  '1M': 30 * 60_000,
};

interface RpcStatsSummary {
  endpoints: EndpointStat[];
  methods: MethodStat[];
}

interface RpcStatsTimeSeries {
  timeseries: RpcTimeSeriesPoint[];
}

export function useRpcStats() {
  const [timeRange, setTimeRange] = useState<TimeRange>('1H');
  const [summary, setSummary] = useState<RpcStatsSummary | null>(null);
  const [timeseries, setTimeseries] = useState<RpcTimeSeriesPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rangeMs: Record<TimeRange, number> = {
    '1H': 60 * 60 * 1000,
    '6H': 6 * 60 * 60 * 1000,
    '1D': 24 * 60 * 60 * 1000,
    '1W': 7 * 24 * 60 * 60 * 1000,
    '1M': 30 * 24 * 60 * 60 * 1000,
  };

  const bucketForRange: Record<TimeRange, string> = {
    '1H': '1m',
    '6H': '5m',
    '1D': '15m',
    '1W': '1h',
    '1M': '4h',
  };

  const fetchData = useCallback(async () => {
    try {
      const to = new Date();
      const from = new Date(to.getTime() - rangeMs[timeRange]);
      const params = `from=${from.toISOString()}&to=${to.toISOString()}`;
      const bucket = bucketForRange[timeRange];

      const [summaryRes, timeseriesRes] = await Promise.all([
        fetch(`/api/admin/rpc-stats?view=summary&${params}`),
        fetch(`/api/admin/rpc-stats?view=timeseries&${params}&bucket=${bucket}`),
      ]);

      if (summaryRes.status === 401 || timeseriesRes.status === 401) {
        setError('Unauthorized - please log in');
        setLoading(false);
        return;
      }

      if (!summaryRes.ok || !timeseriesRes.ok) {
        throw new Error('Failed to fetch RPC stats');
      }

      const summaryData: RpcStatsSummary = await summaryRes.json();
      const timeseriesData: RpcStatsTimeSeries = await timeseriesRes.json();

      setSummary(summaryData);
      setTimeseries(timeseriesData.timeseries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [timeRange]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS[timeRange]);
    return () => clearInterval(interval);
  }, [fetchData, timeRange]);

  return {
    timeRange,
    setTimeRange,
    summary,
    timeseries,
    loading,
    error,
  };
}
