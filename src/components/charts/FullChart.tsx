'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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
import { ChartDataPoint, MilestoneChartDataPoint } from '@/lib/types';
import { formatPol } from '@/lib/utils';
import {
  GWEI_PER_POL,
  CHART_COLOR_PALETTE,
  TIME_RANGE_BUCKETS,
  TIME_RANGE_SECONDS,
} from '@/lib/constants';

interface FullChartProps {
  title: string;
  metric: 'gas' | 'finality' | 'mgas' | 'tps' | 'totalBaseFee' | 'totalPriorityFee' | 'totalFee' | 'blockLimit' | 'blockLimitUtilization' | 'borBlockTime' | 'heimdallBlockTime';
  showCumulative?: boolean;
}

function getRecommendedBucket(range: string): string {
  return TIME_RANGE_BUCKETS[range] ?? '1h';
}

// Format datetime-local input value
function formatDateTimeLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function FullChart({ title, metric, showCumulative = false }: FullChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map());
  const { theme } = useTheme();

  const [timeRange, setTimeRange] = useState('1D');
  const [bucketSize, setBucketSize] = useState('15m');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any[]>([]);
  const [isZoomed, setIsZoomed] = useState(false);
  const timeRangeRef = useRef(timeRange);

  // Custom date range state
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [customStartTime, setCustomStartTime] = useState(formatDateTimeLocal(oneHourAgo));
  const [customEndTime, setCustomEndTime] = useState(formatDateTimeLocal(now));
  const [appliedCustomRange, setAppliedCustomRange] = useState<{ start: number; end: number } | null>(null);

  // Auto-update bucket when time range changes
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

  // Helper to check if time range is longer than 1 day
  const shouldShowDates = (range: string): boolean => {
    if (range === 'Custom' && appliedCustomRange) {
      return (appliedCustomRange.end - appliedCustomRange.start) > 86400;
    }
    const longRanges = ['1D', '1W', '1M', '6M', '1Y', 'ALL'];
    return longRanges.includes(range);
  };

  // Format time based on time range
  const formatTimeLabel = (time: number): string => {
    const date = new Date(time * 1000);
    if (shouldShowDates(timeRangeRef.current)) {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Format tooltip time
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

  const [seriesOptions, setSeriesOptions] = useState(() => {
    const colors = CHART_COLOR_PALETTE;
    if (metric === 'gas') {
      return [
        { key: 'base', label: 'Base', enabled: true, color: colors[0] },
        { key: 'medianPriority', label: 'Median Priority', enabled: true, color: colors[1] },
        { key: 'minPriority', label: 'Min Priority', enabled: false, color: colors[2] },
        { key: 'maxPriority', label: 'Max Priority', enabled: false, color: colors[3] },
        { key: 'total', label: 'Total', enabled: false, color: colors[4] },
      ];
    }
    if (metric === 'totalBaseFee' || metric === 'totalPriorityFee' || metric === 'totalFee') {
      if (showCumulative) {
        return [
          { key: 'cumulative', label: 'Cumulative', enabled: true, color: colors[0] },
          { key: 'perBucket', label: 'Per Period', enabled: false, color: colors[1] },
        ];
      }
      return [
        { key: 'perBucket', label: 'Per Period', enabled: true, color: colors[0] },
      ];
    }
    if (metric === 'blockLimit' || metric === 'blockLimitUtilization') {
      return [
        { key: 'value', label: metric === 'blockLimit' ? 'Block Limit' : 'Utilization %', enabled: true, color: colors[0] },
      ];
    }
    if (metric === 'borBlockTime' || metric === 'heimdallBlockTime') {
      return [
        { key: 'avg', label: 'Avg', enabled: true, color: colors[0] },
        { key: 'min', label: 'Min', enabled: false, color: colors[1] },
        { key: 'max', label: 'Max', enabled: false, color: colors[2] },
      ];
    }
    return [
      { key: 'avg', label: 'Avg', enabled: true, color: colors[0] },
      { key: 'min', label: 'Min', enabled: false, color: colors[1] },
      { key: 'max', label: 'Max', enabled: false, color: colors[2] },
    ];
  });

  const fetchData = useCallback(async () => {
    let fromTime: number;
    let toTime: number;

    if (timeRange === 'Custom' && appliedCustomRange) {
      fromTime = appliedCustomRange.start;
      toTime = appliedCustomRange.end;
    } else {
      toTime = Math.floor(Date.now() / 1000);
      const rangeSeconds = TIME_RANGE_SECONDS[timeRange] ?? 0;
      fromTime = rangeSeconds > 0 ? toTime - rangeSeconds : 0;
    }

    try {
      const endpoint = metric === 'heimdallBlockTime'
        ? '/api/milestone-chart-data'
        : '/api/chart-data';
      const response = await fetch(
        `${endpoint}?fromTime=${fromTime}&toTime=${toTime}&bucketSize=${bucketSize}&limit=5000`
      );
      const json = await response.json();
      setData(json.data || []);
    } catch (error) {
      console.error('Failed to fetch chart data:', error);
    }
  }, [timeRange, bucketSize, appliedCustomRange, metric]);

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
      rightPriceScale: { visible: true, borderVisible: false },
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
        priceFormatter: (price: number) => {
          if (price === null || price === undefined || isNaN(price)) {
            return '-';
          }
          if (metric === 'totalBaseFee' || metric === 'totalPriorityFee') {
            return price.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            });
          }
          return price.toFixed(2);
        },
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
  }, [metric]);

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

  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;

    // Clear existing series
    seriesRefs.current.forEach((series) => chartRef.current?.removeSeries(series));
    seriesRefs.current.clear();

    seriesOptions
      .filter((opt) => opt.enabled)
      .forEach((opt) => {
        const color = opt.color || CHART_COLOR_PALETTE[0];
        let seriesData: LineData<UTCTimestamp>[];

        if (metric === 'gas') {
          seriesData = data.map((d) => {
            const value =
              opt.key === 'base' ? d.baseFee.avg :
              opt.key === 'medianPriority' ? d.priorityFee.median :
              opt.key === 'total' ? d.total.avg :
              opt.key === 'minPriority' ? d.priorityFee.min :
              d.priorityFee.max;
            return { time: d.timestamp as UTCTimestamp, value };
          });
        } else if (metric === 'finality') {
          seriesData = data
            .filter((d) => d.finalityAvg !== null)
            .map((d) => ({ time: d.timestamp as UTCTimestamp, value: d.finalityAvg! }));
        } else if (metric === 'mgas') {
          seriesData = data.map((d) => ({ time: d.timestamp as UTCTimestamp, value: d.mgasPerSec }));
        } else if (metric === 'tps') {
          seriesData = data.map((d) => ({ time: d.timestamp as UTCTimestamp, value: d.tps }));
        } else if (metric === 'totalBaseFee') {
          if (opt.key === 'cumulative') {
            let cumulative = 0;
            seriesData = data.map((d) => {
              cumulative += d.totalBaseFeeSum;
              return { time: d.timestamp as UTCTimestamp, value: cumulative / GWEI_PER_POL };
            });
          } else {
            seriesData = data.map((d) => ({ time: d.timestamp as UTCTimestamp, value: d.totalBaseFeeSum / GWEI_PER_POL }));
          }
        } else if (metric === 'totalPriorityFee') {
          if (opt.key === 'cumulative') {
            let cumulative = 0;
            seriesData = data.map((d) => {
              cumulative += d.totalPriorityFeeSum;
              return { time: d.timestamp as UTCTimestamp, value: cumulative / GWEI_PER_POL };
            });
          } else {
            seriesData = data.map((d) => ({ time: d.timestamp as UTCTimestamp, value: d.totalPriorityFeeSum / GWEI_PER_POL }));
          }
        } else if (metric === 'totalFee') {
          if (opt.key === 'cumulative') {
            let cumulative = 0;
            seriesData = data.map((d) => {
              cumulative += d.totalBaseFeeSum + d.totalPriorityFeeSum;
              return { time: d.timestamp as UTCTimestamp, value: cumulative / GWEI_PER_POL };
            });
          } else {
            seriesData = data.map((d) => ({ time: d.timestamp as UTCTimestamp, value: (d.totalBaseFeeSum + d.totalPriorityFeeSum) / GWEI_PER_POL }));
          }
        } else if (metric === 'blockLimit') {
          // Show average block limit per bucket (in millions of gas)
          seriesData = data.map((d) => ({
            time: d.timestamp as UTCTimestamp,
            value: d.gasLimitSum / (d.blockEnd - d.blockStart + 1) / 1_000_000,
          }));
        } else if (metric === 'blockLimitUtilization') {
          // Show gas utilization percentage
          seriesData = data.map((d) => ({
            time: d.timestamp as UTCTimestamp,
            value: d.gasLimitSum > 0 ? (d.gasUsedSum / d.gasLimitSum) * 100 : 0,
          }));
        } else if (metric === 'borBlockTime' || metric === 'heimdallBlockTime') {
          // Show block time (time between consecutive blocks/milestones)
          seriesData = data
            .filter((d: ChartDataPoint | MilestoneChartDataPoint) => d.blockTimeAvg !== null)
            .map((d: ChartDataPoint | MilestoneChartDataPoint) => {
              const value =
                opt.key === 'avg' ? d.blockTimeAvg! :
                opt.key === 'min' ? (d.blockTimeMin ?? d.blockTimeAvg!) :
                (d.blockTimeMax ?? d.blockTimeAvg!);
              return { time: d.timestamp as UTCTimestamp, value };
            });
        } else {
          seriesData = data.map((d) => ({ time: d.timestamp as UTCTimestamp, value: d.tps }));
        }

        const series = chartRef.current!.addSeries(LineSeries, {
          color,
          lineWidth: 2,
          priceScaleId: 'left',
        });

        series.setData(seriesData);
        seriesRefs.current.set(opt.key, series);
      });

    chartRef.current.timeScale().fitContent();
  }, [data, seriesOptions, metric]);

  const handleSeriesToggle = (key: string) => {
    setSeriesOptions((prev) =>
      prev.map((opt) => (opt.key === key ? { ...opt, enabled: !opt.enabled } : opt))
    );
  };

  const handleResetZoom = () => {
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
      setIsZoomed(false);
    }
  };

  // Calculate period total for cumulative fee charts
  const periodTotal = (() => {
    if (!showCumulative || data.length === 0) return null;
    if (metric === 'totalBaseFee') {
      return data.reduce((sum, d) => sum + d.totalBaseFeeSum, 0);
    }
    if (metric === 'totalPriorityFee') {
      return data.reduce((sum, d) => sum + d.totalPriorityFeeSum, 0);
    }
    if (metric === 'totalFee') {
      return data.reduce((sum, d) => sum + d.totalBaseFeeSum + d.totalPriorityFeeSum, 0);
    }
    return null;
  })();

  const formatFeeAsPol = (gweiValue: number): string => {
    return formatPol(gweiValue / GWEI_PER_POL);
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">{title}</h3>
        <div className="flex items-center gap-3">
          {periodTotal !== null && (
            <div className="text-right">
              <span className="text-sm text-gray-500 dark:text-gray-400">Period Total: </span>
              <span className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                {formatFeeAsPol(periodTotal)} POL
              </span>
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
      <ChartControls
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        bucketSize={bucketSize}
        onBucketSizeChange={setBucketSize}
        seriesOptions={seriesOptions}
        onSeriesToggle={handleSeriesToggle}
        customStartTime={customStartTime}
        customEndTime={customEndTime}
        onCustomStartTimeChange={setCustomStartTime}
        onCustomEndTimeChange={setCustomEndTime}
        onApplyCustomRange={handleApplyCustomRange}
      />
      <div ref={chartContainerRef} className="w-full mt-4 cursor-crosshair" title="Scroll to zoom, drag to pan" />
    </div>
  );
}
