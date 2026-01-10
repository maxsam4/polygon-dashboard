'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineData,
  UTCTimestamp,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  CandlestickSeries,
  CandlestickData,
  SeriesType,
} from 'lightweight-charts';
import { useTheme } from '../ThemeProvider';
import { ChartControls } from './ChartControls';
import { ChartDataPoint } from '@/lib/types';
import { formatPol } from '@/lib/utils';
import {
  GWEI_PER_POL,
  CHART_COLOR_PALETTE,
  TIME_RANGE_BUCKETS,
  TIME_RANGE_SECONDS,
} from '@/lib/constants';

interface FullChartProps {
  title: string;
  metric: 'gas' | 'finality' | 'mgas' | 'tps' | 'totalBaseFee' | 'totalPriorityFee';
  showCumulative?: boolean;
}

function getRecommendedBucket(range: string): string {
  return TIME_RANGE_BUCKETS[range] ?? '2s';
}

export function FullChart({ title, metric, showCumulative = false }: FullChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map());
  const { theme } = useTheme();

  const [timeRange, setTimeRange] = useState('1H');
  const [bucketSize, setBucketSize] = useState('1m');
  const [chartType, setChartType] = useState('Line');
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [isZoomed, setIsZoomed] = useState(false);

  // Auto-update bucket when time range changes
  const handleTimeRangeChange = (range: string) => {
    setTimeRange(range);
    setBucketSize(getRecommendedBucket(range));
  };

  const [seriesOptions, setSeriesOptions] = useState(() => {
    if (metric === 'gas') {
      return [
        { key: 'base', label: 'Base', enabled: true },
        { key: 'medianPriority', label: 'Median Priority', enabled: true },
        { key: 'minPriority', label: 'Min Priority', enabled: false },
        { key: 'maxPriority', label: 'Max Priority', enabled: false },
        { key: 'total', label: 'Total', enabled: false },
      ];
    }
    if (metric === 'totalBaseFee' || metric === 'totalPriorityFee') {
      if (showCumulative) {
        return [
          { key: 'cumulative', label: 'Cumulative', enabled: true },
          { key: 'perBucket', label: 'Per Period', enabled: false },
        ];
      }
      return [
        { key: 'perBucket', label: 'Per Period', enabled: true },
      ];
    }
    return [
      { key: 'avg', label: 'Avg', enabled: true },
      { key: 'min', label: 'Min', enabled: false },
      { key: 'max', label: 'Max', enabled: false },
    ];
  });

  const fetchData = useCallback(async () => {
    const now = Math.floor(Date.now() / 1000);
    const rangeSeconds = TIME_RANGE_SECONDS[timeRange] ?? 0;
    const fromTime = rangeSeconds > 0 ? now - rangeSeconds : 0;

    try {
      const response = await fetch(
        `/api/chart-data?fromTime=${fromTime}&toTime=${now}&bucketSize=${bucketSize}&limit=5000`
      );
      const json = await response.json();
      setData(json.data || []);
    } catch (error) {
      console.error('Failed to fetch chart data:', error);
    }
  }, [timeRange, bucketSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
        tickMarkFormatter: (time: number) => {
          const date = new Date(time * 1000);
          return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        },
      },
      localization: {
        timeFormatter: (timestamp: number) => {
          const date = new Date(timestamp * 1000);
          return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        },
        priceFormatter: (price: number) => {
          // Format with commas for fee charts (already in POL)
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

    // Track zoom state
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
  }, [theme, metric]);

  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;

    // Clear existing series
    seriesRefs.current.forEach((series) => chartRef.current?.removeSeries(series));
    seriesRefs.current.clear();

    const colors = CHART_COLOR_PALETTE;

    seriesOptions
      .filter((opt) => opt.enabled)
      .forEach((opt, index) => {
        const color = colors[index % colors.length];

        // For candlestick, only base fee has OHLC data
        const useCandlestick = chartType === 'Candle' && metric === 'gas' && opt.key === 'base';

        if (useCandlestick) {
          // Candlestick series for base fee OHLC
          const candleData: CandlestickData<UTCTimestamp>[] = data.map((d) => ({
            time: d.timestamp as UTCTimestamp,
            open: d.baseFee.open,
            high: d.baseFee.high,
            low: d.baseFee.low,
            close: d.baseFee.close,
          }));

          const series = chartRef.current!.addSeries(CandlestickSeries, {
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350',
            title: opt.label,
            priceScaleId: 'left',
          });
          series.setData(candleData);
          seriesRefs.current.set(opt.key, series);
        } else {
          // Line data for all other cases
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
            // Convert gwei to POL (1 POL = 1,000,000 gwei)
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
            // Convert gwei to POL (1 POL = 1,000,000 gwei)
            if (opt.key === 'cumulative') {
              let cumulative = 0;
              seriesData = data.map((d) => {
                cumulative += d.totalPriorityFeeSum;
                return { time: d.timestamp as UTCTimestamp, value: cumulative / GWEI_PER_POL };
              });
            } else {
              seriesData = data.map((d) => ({ time: d.timestamp as UTCTimestamp, value: d.totalPriorityFeeSum / GWEI_PER_POL }));
            }
          } else {
            seriesData = data.map((d) => ({ time: d.timestamp as UTCTimestamp, value: d.tps }));
          }

          // Create series based on chart type
          let series: ISeriesApi<SeriesType>;

          if (chartType === 'Area') {
            series = chartRef.current!.addSeries(AreaSeries, {
              lineColor: color,
              topColor: `${color}80`,
              bottomColor: `${color}10`,
              lineWidth: 2,
              title: opt.label,
              priceScaleId: 'left',
            });
          } else if (chartType === 'Bar') {
            series = chartRef.current!.addSeries(HistogramSeries, {
              color,
              title: opt.label,
              priceScaleId: 'left',
            });
          } else {
            // Default to Line (also used for Candle when not base fee)
            series = chartRef.current!.addSeries(LineSeries, {
              color,
              lineWidth: 2,
              title: opt.label,
              priceScaleId: 'left',
            });
          }

          series.setData(seriesData);
          seriesRefs.current.set(opt.key, series);
        }
      });

    chartRef.current.timeScale().fitContent();
  }, [data, seriesOptions, metric, chartType]);

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
    return null;
  })();

  // Format fee in POL with commas
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
        chartType={chartType}
        onChartTypeChange={setChartType}
        seriesOptions={seriesOptions}
        onSeriesToggle={handleSeriesToggle}
      />
      <div ref={chartContainerRef} className="w-full mt-4 cursor-crosshair" title="Scroll to zoom, drag to pan" />
    </div>
  );
}
