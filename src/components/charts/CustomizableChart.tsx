'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineData,
  UTCTimestamp,
  LineSeries,
  SeriesType,
} from 'lightweight-charts';
import { useTheme } from '../ThemeProvider';
import { ChartControls } from './ChartControls';
import { ChartDataPoint } from '@/lib/types';
import { formatPol } from '@/lib/utils';
import {
  GWEI_PER_POL,
  CHART_COLORS,
  TIME_RANGE_BUCKETS,
  TIME_RANGE_SECONDS,
  getAvailableBuckets,
  getTimeRangeSeconds,
} from '@/lib/constants';

// Available data series options
const DATA_OPTIONS = [
  { value: 'baseFee', label: 'Base Fee (gwei)' },
  { value: 'medianPriorityFee', label: 'Median Priority Fee (gwei)' },
  { value: 'totalGasPrice', label: 'Total Gas Price (gwei)' },
  { value: 'blockLimit', label: 'Block Limit (M gas)' },
  { value: 'blockLimitUtilization', label: 'Block Utilization (%)' },
  { value: 'mgas', label: 'MGAS/s' },
  { value: 'tps', label: 'TPS' },
  { value: 'totalBaseFee', label: 'Base Fee per Block (POL)' },
  { value: 'totalPriorityFee', label: 'Priority Fee per Block (POL)' },
  { value: 'totalFee', label: 'Total Fee per Block (POL)' },
  { value: 'cumulativeBaseFee', label: 'Cumulative Base Fee (POL)' },
  { value: 'cumulativePriorityFee', label: 'Cumulative Priority Fee (POL)' },
  { value: 'cumulativeTotalFee', label: 'Cumulative Total Fee (POL)' },
] as const;

type DataOptionValue = (typeof DATA_OPTIONS)[number]['value'];

interface CustomizableChartProps {
  title: string;
  defaultLeftSeries: DataOptionValue;
  defaultRightSeries: DataOptionValue;
  dualAxis: boolean; // If true, right series uses right axis; if false, both use left
}

function getRecommendedBucket(range: string): string {
  return TIME_RANGE_BUCKETS[range] ?? '1h';
}

function formatDateTimeLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getSeriesValue(d: ChartDataPoint, series: DataOptionValue, cumulativeBaseFee: number, cumulativePriorityFee: number): number {
  switch (series) {
    case 'baseFee':
      return d.baseFee.avg;
    case 'medianPriorityFee':
      return d.priorityFee.median;
    case 'totalGasPrice':
      return d.total.avg;
    case 'blockLimit':
      return d.gasLimitSum / Math.max(1, d.blockEnd - d.blockStart + 1) / 1_000_000;
    case 'blockLimitUtilization':
      return d.gasLimitSum > 0 ? (d.gasUsedSum / d.gasLimitSum) * 100 : 0;
    case 'mgas':
      return d.mgasPerSec;
    case 'tps':
      return d.tps;
    case 'totalBaseFee':
      return d.totalBaseFeeSum / GWEI_PER_POL;
    case 'totalPriorityFee':
      return d.totalPriorityFeeSum / GWEI_PER_POL;
    case 'totalFee':
      return (d.totalBaseFeeSum + d.totalPriorityFeeSum) / GWEI_PER_POL;
    case 'cumulativeBaseFee':
      return cumulativeBaseFee / GWEI_PER_POL;
    case 'cumulativePriorityFee':
      return cumulativePriorityFee / GWEI_PER_POL;
    case 'cumulativeTotalFee':
      return (cumulativeBaseFee + cumulativePriorityFee) / GWEI_PER_POL;
    default:
      return 0;
  }
}

function isCumulativeSeries(series: DataOptionValue): boolean {
  return series === 'cumulativeBaseFee' || series === 'cumulativePriorityFee' || series === 'cumulativeTotalFee';
}

export function CustomizableChart({
  title,
  defaultLeftSeries,
  defaultRightSeries,
  dualAxis,
}: CustomizableChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map());
  const { theme } = useTheme();

  const [timeRange, setTimeRange] = useState('1D');
  const [bucketSize, setBucketSize] = useState('15m');
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isDataComplete, setIsDataComplete] = useState(true);
  const timeRangeRef = useRef(timeRange);

  const [leftSeries, setLeftSeries] = useState<DataOptionValue>(defaultLeftSeries);
  const [rightSeries, setRightSeries] = useState<DataOptionValue>(defaultRightSeries);

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

  const handleTimeRangeChange = (range: string) => {
    setTimeRange(range);
    if (range !== 'Custom') {
      setBucketSize(getRecommendedBucket(range));
      setAppliedCustomRange(null);
    }
    timeRangeRef.current = range;
  };

  const handleApplyCustomRange = () => {
    const start = Math.floor(new Date(customStartTime).getTime() / 1000);
    const end = Math.floor(new Date(customEndTime).getTime() / 1000);
    if (start < end) {
      setAppliedCustomRange({ start, end });
    }
  };

  const shouldShowDates = (range: string): boolean => {
    if (range === 'Custom' && appliedCustomRange) {
      return (appliedCustomRange.end - appliedCustomRange.start) > 86400;
    }
    const longRanges = ['1D', '1W', '1M', '6M', '1Y', 'YTD', 'ALL'];
    return longRanges.includes(range);
  };

  const formatTimeLabel = (time: number): string => {
    const date = new Date(time * 1000);
    if (shouldShowDates(timeRangeRef.current)) {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatTooltipTime = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    if (shouldShowDates(timeRangeRef.current)) {
      return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

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

    try {
      const response = await fetch(
        `/api/chart-data?fromTime=${fromTime}&toTime=${toTime}&bucketSize=${bucketSize}&limit=10000`
      );
      const json = await response.json();
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
  }, [timeRange, bucketSize, appliedCustomRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Create chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 300,
      layout: {
        background: { color: 'transparent' },
        textColor: theme === 'dark' ? '#d1d5db' : '#374151',
      },
      grid: {
        vertLines: { color: theme === 'dark' ? '#374151' : '#e5e7eb' },
        horzLines: { color: theme === 'dark' ? '#374151' : '#e5e7eb' },
      },
      rightPriceScale: { visible: dualAxis, borderVisible: false },
      leftPriceScale: { visible: true, borderVisible: false },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        rightOffset: 5,
        tickMarkFormatter: (time: number) => formatTimeLabel(time),
      },
      localization: {
        timeFormatter: (timestamp: number) => formatTooltipTime(timestamp),
        priceFormatter: (price: number) => price.toFixed(2),
      },
    });

    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    const handleVisibleRangeChange = () => {
      setIsZoomed(true);
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
    window.addEventListener('resize', handleResize);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualAxis]);

  // Update theme colors
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        layout: {
          textColor: theme === 'dark' ? '#d1d5db' : '#374151',
        },
        grid: {
          vertLines: { color: theme === 'dark' ? '#374151' : '#e5e7eb' },
          horzLines: { color: theme === 'dark' ? '#374151' : '#e5e7eb' },
        },
      });
    }
  }, [theme]);

  // Update series data
  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;

    // Clear existing series
    seriesRefs.current.forEach((series) => chartRef.current?.removeSeries(series));
    seriesRefs.current.clear();

    // Calculate cumulative values for all data points
    let cumulativeBaseFee = 0;
    let cumulativePriorityFee = 0;
    const cumulativeValues = data.map((d) => {
      cumulativeBaseFee += d.totalBaseFeeSum;
      cumulativePriorityFee += d.totalPriorityFeeSum;
      return { cumulativeBaseFee, cumulativePriorityFee };
    });

    // Create left series
    const leftSeriesData: LineData<UTCTimestamp>[] = data.map((d, i) => ({
      time: d.timestamp as UTCTimestamp,
      value: getSeriesValue(d, leftSeries, cumulativeValues[i].cumulativeBaseFee, cumulativeValues[i].cumulativePriorityFee),
    }));

    const leftSeriesObj = chartRef.current.addSeries(LineSeries, {
      color: CHART_COLORS.PRIMARY,
      lineWidth: 2,
      priceScaleId: 'left',
    });
    leftSeriesObj.setData(leftSeriesData);
    seriesRefs.current.set('left', leftSeriesObj);

    // Create right series
    const rightSeriesData: LineData<UTCTimestamp>[] = data.map((d, i) => ({
      time: d.timestamp as UTCTimestamp,
      value: getSeriesValue(d, rightSeries, cumulativeValues[i].cumulativeBaseFee, cumulativeValues[i].cumulativePriorityFee),
    }));

    const rightSeriesObj = chartRef.current.addSeries(LineSeries, {
      color: CHART_COLORS.SECONDARY,
      lineWidth: 2,
      priceScaleId: dualAxis ? 'right' : 'left',
    });
    rightSeriesObj.setData(rightSeriesData);
    seriesRefs.current.set('right', rightSeriesObj);

    chartRef.current.timeScale().fitContent();
  }, [data, leftSeries, rightSeries, dualAxis]);

  const handleResetZoom = () => {
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
      setIsZoomed(false);
    }
  };

  // Calculate cumulative totals for display (only show when data is complete)
  const cumulativeTotals = (() => {
    if (data.length === 0 || !isDataComplete) return { baseFee: null, priorityFee: null, totalFee: null };

    const showBaseFee = isCumulativeSeries(leftSeries) || isCumulativeSeries(rightSeries);
    if (!showBaseFee) return { baseFee: null, priorityFee: null, totalFee: null };

    const totalBaseFee = data.reduce((sum, d) => sum + d.totalBaseFeeSum, 0);
    const totalPriorityFee = data.reduce((sum, d) => sum + d.totalPriorityFeeSum, 0);

    const showCumulativeBaseFee = leftSeries === 'cumulativeBaseFee' || rightSeries === 'cumulativeBaseFee';
    const showCumulativePriorityFee = leftSeries === 'cumulativePriorityFee' || rightSeries === 'cumulativePriorityFee';
    const showCumulativeTotalFee = leftSeries === 'cumulativeTotalFee' || rightSeries === 'cumulativeTotalFee';

    return {
      baseFee: showCumulativeBaseFee ? totalBaseFee : null,
      priorityFee: showCumulativePriorityFee ? totalPriorityFee : null,
      totalFee: showCumulativeTotalFee ? totalBaseFee + totalPriorityFee : null,
    };
  })();

  const formatFeeAsPol = (gweiValue: number): string => {
    return formatPol(gweiValue / GWEI_PER_POL);
  };

  // Dummy series options for ChartControls (we don't use series toggles for customizable charts)
  const seriesOptions: { key: string; label: string; enabled: boolean }[] = [];

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-4">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold">{title}</h3>
        <div className="flex flex-col items-end gap-2">
          {/* Cumulative totals display */}
          {(cumulativeTotals.baseFee !== null || cumulativeTotals.priorityFee !== null || cumulativeTotals.totalFee !== null) && (
            <div className="text-right text-sm">
              {cumulativeTotals.baseFee !== null && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Base Fee: </span>
                  <span className="font-semibold text-blue-600 dark:text-blue-400">
                    {formatFeeAsPol(cumulativeTotals.baseFee)} POL
                  </span>
                </div>
              )}
              {cumulativeTotals.priorityFee !== null && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Priority Fee: </span>
                  <span className="font-semibold text-orange-600 dark:text-orange-400">
                    {formatFeeAsPol(cumulativeTotals.priorityFee)} POL
                  </span>
                </div>
              )}
              {cumulativeTotals.totalFee !== null && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Total Fee: </span>
                  <span className="font-semibold text-green-600 dark:text-green-400">
                    {formatFeeAsPol(cumulativeTotals.totalFee)} POL
                  </span>
                </div>
              )}
            </div>
          )}
          {isZoomed && (
            <button
              onClick={handleResetZoom}
              className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded transition-colors"
              title="Reset zoom to show all data"
            >
              Reset Zoom
            </button>
          )}
        </div>
      </div>

      {/* Series selectors */}
      <div className="flex flex-wrap gap-4 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHART_COLORS.PRIMARY }} />
          <select
            value={leftSeries}
            onChange={(e) => setLeftSeries(e.target.value as DataOptionValue)}
            className="text-sm border rounded px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-600"
          >
            {DATA_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-500">(Left axis)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHART_COLORS.SECONDARY }} />
          <select
            value={rightSeries}
            onChange={(e) => setRightSeries(e.target.value as DataOptionValue)}
            className="text-sm border rounded px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-600"
          >
            {DATA_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-500">({dualAxis ? 'Right' : 'Left'} axis)</span>
        </div>
      </div>

      <ChartControls
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        bucketSize={bucketSize}
        onBucketSizeChange={setBucketSize}
        seriesOptions={seriesOptions}
        onSeriesToggle={() => {}}
        customStartTime={customStartTime}
        customEndTime={customEndTime}
        onCustomStartTimeChange={setCustomStartTime}
        onCustomEndTimeChange={setCustomEndTime}
        onApplyCustomRange={handleApplyCustomRange}
        availableBuckets={availableBuckets}
      />
      <div ref={chartContainerRef} className="w-full mt-4 cursor-crosshair" title="Scroll to zoom, drag to pan" />
    </div>
  );
}
