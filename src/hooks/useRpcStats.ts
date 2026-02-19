'use client';

import { useState, useEffect, useCallback } from 'react';
import type { EndpointStat, MethodStat, RpcTimeSeriesPoint } from '@/lib/queries/rpcStats';

const POLL_INTERVAL_MS = 30_000;

type TimeRange = '1H' | '6H' | '1D';

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
  };

  const bucketForRange: Record<TimeRange, string> = {
    '1H': '1m',
    '6H': '5m',
    '1D': '15m',
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
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  return {
    timeRange,
    setTimeRange,
    summary,
    timeseries,
    loading,
    error,
  };
}
