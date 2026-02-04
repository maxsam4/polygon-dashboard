'use client';

import { createContext, useContext, useState, useCallback, useEffect, useMemo, ReactNode } from 'react';
import { TIME_RANGE_SECONDS, TIME_RANGE_BUCKETS, getAvailableBuckets, getTimeRangeSeconds } from '@/lib/constants';
import { ChartDataPoint, MilestoneChartDataPoint } from '@/lib/types';
import { formatDateTimeLocal } from '@/lib/dateUtils';

export interface TimeRangeBounds {
  from: number;
  to: number;
}

interface ChartDataContextValue {
  // Shared state
  timeRange: string;
  setTimeRange: (range: string) => void;
  bucketSize: string;
  setBucketSize: (size: string) => void;
  availableBuckets: string[];

  // Custom range
  customStartTime: string;
  setCustomStartTime: (time: string) => void;
  customEndTime: string;
  setCustomEndTime: (time: string) => void;
  appliedCustomRange: { start: number; end: number } | null;
  applyCustomRange: () => void;

  // Shared data
  chartData: ChartDataPoint[];
  milestoneData: MilestoneChartDataPoint[];
  isLoading: boolean;
  isDataComplete: boolean;
  timeRangeBounds: TimeRangeBounds | null;

  // Refetch
  refetch: () => void;
}

const ChartDataContext = createContext<ChartDataContextValue | null>(null);

export function useSharedChartData() {
  const context = useContext(ChartDataContext);
  if (!context) {
    throw new Error('useSharedChartData must be used within a ChartDataProvider');
  }
  return context;
}

// Optional hook that returns null if not in provider (for components that can work either way)
export function useOptionalSharedChartData() {
  return useContext(ChartDataContext);
}

function getRecommendedBucket(range: string): string {
  return TIME_RANGE_BUCKETS[range] ?? '1h';
}

interface ChartDataProviderProps {
  children: ReactNode;
}

export function ChartDataProvider({ children }: ChartDataProviderProps) {
  const [timeRange, setTimeRangeState] = useState('1D');
  const [bucketSize, setBucketSize] = useState('15m');
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [milestoneData, setMilestoneData] = useState<MilestoneChartDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDataComplete, setIsDataComplete] = useState(true);
  const [timeRangeBounds, setTimeRangeBounds] = useState<TimeRangeBounds | null>(null);

  // Custom date range state
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [customStartTime, setCustomStartTime] = useState(formatDateTimeLocal(oneDayAgo));
  const [customEndTime, setCustomEndTime] = useState(formatDateTimeLocal(now));
  const [appliedCustomRange, setAppliedCustomRange] = useState<{ start: number; end: number } | null>(null);

  // Calculate available bucket sizes based on time range
  const availableBuckets = useMemo(() => {
    const seconds = getTimeRangeSeconds(timeRange, appliedCustomRange);
    return getAvailableBuckets(seconds);
  }, [timeRange, appliedCustomRange]);

  // Auto-adjust bucket size when it becomes invalid for the current time range
  useEffect(() => {
    if (availableBuckets.length > 0 && !availableBuckets.includes(bucketSize)) {
      const recommended = TIME_RANGE_BUCKETS[timeRange];
      const newBucket = availableBuckets.find(b => b === recommended) ?? availableBuckets[0];
      setBucketSize(newBucket);
    }
  }, [availableBuckets, bucketSize, timeRange]);

  const setTimeRange = useCallback((range: string) => {
    setTimeRangeState(range);
    if (range !== 'Custom') {
      setBucketSize(getRecommendedBucket(range));
      setAppliedCustomRange(null);
    }
  }, []);

  const applyCustomRange = useCallback(() => {
    const start = Math.floor(new Date(customStartTime).getTime() / 1000);
    const end = Math.floor(new Date(customEndTime).getTime() / 1000);
    if (start < end) {
      setAppliedCustomRange({ start, end });
    }
  }, [customStartTime, customEndTime]);

  const fetchData = useCallback(async () => {
    // Guard: Don't fetch if Custom is selected but not yet applied
    if (timeRange === 'Custom' && !appliedCustomRange) {
      return;
    }

    setIsLoading(true);

    let fromTime: number;
    let toTime: number;

    if (timeRange === 'Custom' && appliedCustomRange) {
      fromTime = appliedCustomRange.start;
      toTime = appliedCustomRange.end;
    } else if (timeRange === 'YTD') {
      const now = new Date();
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      fromTime = Math.floor(startOfYear.getTime() / 1000);
      toTime = Math.floor(Date.now() / 1000);
    } else {
      toTime = Math.floor(Date.now() / 1000);
      const rangeSeconds = TIME_RANGE_SECONDS[timeRange] ?? 0;
      fromTime = rangeSeconds > 0 ? toTime - rangeSeconds : 0;
    }

    setTimeRangeBounds({ from: fromTime, to: toTime });

    try {
      // Fetch both endpoints in parallel
      const [chartResponse, milestoneResponse] = await Promise.all([
        fetch(`/api/chart-data?fromTime=${fromTime}&toTime=${toTime}&bucketSize=${bucketSize}&limit=10000`),
        fetch(`/api/milestone-chart-data?fromTime=${fromTime}&toTime=${toTime}&bucketSize=${bucketSize}&limit=10000`),
      ]);

      const [chartJson, milestoneJson] = await Promise.all([
        chartResponse.json(),
        milestoneResponse.json(),
      ]);

      setChartData(chartJson.data || []);
      setMilestoneData(milestoneJson.data || []);

      if (chartJson.pagination) {
        setIsDataComplete(chartJson.pagination.total <= chartJson.pagination.limit);
      } else {
        setIsDataComplete(true);
      }
    } catch (error) {
      console.error('Failed to fetch chart data:', error);
      setIsDataComplete(true);
    } finally {
      setIsLoading(false);
    }
  }, [timeRange, bucketSize, appliedCustomRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const value: ChartDataContextValue = {
    timeRange,
    setTimeRange,
    bucketSize,
    setBucketSize,
    availableBuckets,
    customStartTime,
    setCustomStartTime,
    customEndTime,
    setCustomEndTime,
    appliedCustomRange,
    applyCustomRange,
    chartData,
    milestoneData,
    isLoading,
    isDataComplete,
    timeRangeBounds,
    refetch: fetchData,
  };

  return (
    <ChartDataContext.Provider value={value}>
      {children}
    </ChartDataContext.Provider>
  );
}
