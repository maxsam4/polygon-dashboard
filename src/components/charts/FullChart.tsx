'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, LineData } from 'lightweight-charts';
import { useTheme } from '../ThemeProvider';
import { ChartControls } from './ChartControls';

interface ChartDataPoint {
  timestamp: number;
  blockStart: number;
  blockEnd: number;
  baseFee: { open: number; high: number; low: number; close: number; avg: number };
  priorityFee: { avg: number; min: number; max: number };
  total: { avg: number; min: number; max: number };
  mgasPerSec: number;
  tps: number;
  finalityAvg: number | null;
}

interface FullChartProps {
  title: string;
  metric: 'gas' | 'finality' | 'mgas' | 'tps';
}

export function FullChart({ title, metric }: FullChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const { theme } = useTheme();

  const [timeRange, setTimeRange] = useState('1H');
  const [bucketSize, setBucketSize] = useState('1m');
  const [chartType, setChartType] = useState('Line');
  const [data, setData] = useState<ChartDataPoint[]>([]);

  const [seriesOptions, setSeriesOptions] = useState(() => {
    if (metric === 'gas') {
      return [
        { key: 'base', label: 'Base', enabled: true },
        { key: 'avgPriority', label: 'Avg Priority', enabled: true },
        { key: 'total', label: 'Total', enabled: true },
        { key: 'minPriority', label: 'Min Priority', enabled: false },
        { key: 'maxPriority', label: 'Max Priority', enabled: false },
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
    let fromTime: number;

    switch (timeRange) {
      case '1H': fromTime = now - 3600; break;
      case '6H': fromTime = now - 6 * 3600; break;
      case '1D': fromTime = now - 86400; break;
      case '1W': fromTime = now - 7 * 86400; break;
      case '1M': fromTime = now - 30 * 86400; break;
      case '6M': fromTime = now - 180 * 86400; break;
      case '1Y': fromTime = now - 365 * 86400; break;
      default: fromTime = 0;
    }

    try {
      const response = await fetch(
        `/api/chart-data?fromTime=${fromTime}&toTime=${now}&bucketSize=${bucketSize}`
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
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
    });

    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [theme]);

  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;

    // Clear existing series
    seriesRefs.current.forEach((series) => chartRef.current?.removeSeries(series));
    seriesRefs.current.clear();

    const colors = ['#2962FF', '#FF6D00', '#00C853', '#AA00FF', '#FF1744'];

    seriesOptions
      .filter((opt) => opt.enabled)
      .forEach((opt, index) => {
        const color = colors[index % colors.length];
        let seriesData: LineData[];

        if (metric === 'gas') {
          seriesData = data.map((d) => {
            const value =
              opt.key === 'base' ? d.baseFee.avg :
              opt.key === 'avgPriority' ? d.priorityFee.avg :
              opt.key === 'total' ? d.total.avg :
              opt.key === 'minPriority' ? d.priorityFee.min :
              d.priorityFee.max;
            return { time: d.timestamp as number, value };
          });
        } else if (metric === 'finality') {
          seriesData = data
            .filter((d) => d.finalityAvg !== null)
            .map((d) => ({ time: d.timestamp as number, value: d.finalityAvg! }));
        } else if (metric === 'mgas') {
          seriesData = data.map((d) => ({ time: d.timestamp as number, value: d.mgasPerSec }));
        } else {
          seriesData = data.map((d) => ({ time: d.timestamp as number, value: d.tps }));
        }

        const series = chartRef.current!.addLineSeries({
          color,
          lineWidth: 2,
          title: opt.label,
        });
        series.setData(seriesData);
        seriesRefs.current.set(opt.key, series);
      });

    chartRef.current.timeScale().fitContent();
  }, [data, seriesOptions, metric, chartType]);

  const handleSeriesToggle = (key: string) => {
    setSeriesOptions((prev) =>
      prev.map((opt) => (opt.key === key ? { ...opt, enabled: !opt.enabled } : opt))
    );
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      <ChartControls
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        bucketSize={bucketSize}
        onBucketSizeChange={setBucketSize}
        chartType={chartType}
        onChartTypeChange={setChartType}
        seriesOptions={seriesOptions}
        onSeriesToggle={handleSeriesToggle}
      />
      <div ref={chartContainerRef} className="w-full mt-4" />
    </div>
  );
}
