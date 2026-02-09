'use client';

import { useState, useCallback, useEffect } from 'react';
import { TIME_RANGE_SECONDS } from '@/lib/constants';
import { getApiEndpointForMetric, ChartMetric } from '@/lib/chartSeriesConfig';
import { ChartDataPoint, MilestoneChartDataPoint } from '@/lib/types';
import { cachedFetch } from '@/lib/fetchCache';

export type ChartData = ChartDataPoint | MilestoneChartDataPoint;

/**
 * Type guard to check if a data point is a ChartDataPoint (block-based chart data).
 */
export function isChartDataPoint(data: ChartData): data is ChartDataPoint {
  return 'baseFee' in data;
}

/**
 * Type guard to check if a data point is a MilestoneChartDataPoint.
 */
export function isMilestoneChartDataPoint(data: ChartData): data is MilestoneChartDataPoint {
  return 'milestoneId' in data && !('baseFee' in data);
}

export interface TimeRangeBounds {
  from: number;
  to: number;
}

export interface UseChartDataOptions {
  metric: ChartMetric;
  timeRange: string;
  bucketSize: string;
  appliedCustomRange: { start: number; end: number } | null;
}

export interface UseChartDataResult {
  data: ChartData[];
  isDataComplete: boolean;
  timeRangeBounds: TimeRangeBounds | null;
  fetchData: () => Promise<void>;
}

/**
 * Hook for fetching chart data based on time range and bucket size.
 * Handles time range calculations, API fetching, and data completeness tracking.
 */
export function useChartData({
  metric,
  timeRange,
  bucketSize,
  appliedCustomRange,
}: UseChartDataOptions): UseChartDataResult {
  const [data, setData] = useState<ChartData[]>([]);
  const [isDataComplete, setIsDataComplete] = useState(true);
  const [timeRangeBounds, setTimeRangeBounds] = useState<TimeRangeBounds | null>(null);

  const fetchData = useCallback(async () => {
    // Guard: Don't fetch if Custom is selected but not yet applied
    if (timeRange === 'Custom' && !appliedCustomRange) {
      return; // Keep existing data visible while user enters dates
    }

    let fromTime: number;
    let toTime: number;

    if (timeRange === 'Custom' && appliedCustomRange) {
      fromTime = appliedCustomRange.start;
      toTime = appliedCustomRange.end;
    } else if (timeRange === 'YTD') {
      // Year-to-Date: from January 1st of current year to now
      const now = new Date();
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      fromTime = Math.floor(startOfYear.getTime() / 1000);
      toTime = Math.floor(Date.now() / 1000);
    } else {
      toTime = Math.floor(Date.now() / 1000);
      const rangeSeconds = TIME_RANGE_SECONDS[timeRange] ?? 0;
      fromTime = rangeSeconds > 0 ? toTime - rangeSeconds : 0;
    }

    // Store the requested time range for proper chart scaling
    setTimeRangeBounds({ from: fromTime, to: toTime });

    try {
      const endpoint = getApiEndpointForMetric(metric);
      const json = await cachedFetch<{ data?: ChartData[]; pagination?: { total: number; limit: number } }>(
        `${endpoint}?fromTime=${fromTime}&toTime=${toTime}&bucketSize=${bucketSize}&limit=10000`
      );
      setData(json.data || []);
      // Check if we received all the data or hit the limit
      if (json.pagination) {
        setIsDataComplete(json.pagination.total <= json.pagination.limit);
      } else {
        setIsDataComplete(true);
      }
    } catch (error) {
      console.error('Failed to fetch chart data:', error);
      setIsDataComplete(true);
    }
  }, [timeRange, bucketSize, appliedCustomRange, metric]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    data,
    isDataComplete,
    timeRangeBounds,
    fetchData,
  };
}
