'use client';

import { useEffect, useRef, useMemo } from 'react';
import { createChart, IChartApi, ISeriesApi, LineSeries, UTCTimestamp } from 'lightweight-charts';
import { useTheme } from '@/components/ThemeProvider';
import type { RpcTimeSeriesPoint } from '@/lib/queries/rpcStats';

const CHART_HEIGHT = 250;
const ENDPOINT_COLORS = [
  '#00FF41', '#00D4FF', '#FFB800', '#FF3B3B',
  '#A855F7', '#F97316', '#14B8A6', '#EC4899',
];

interface RpcPerformanceChartProps {
  data: RpcTimeSeriesPoint[];
  valueKey: 'p95_response_ms' | 'success_rate' | 'avg_response_ms';
  title: string;
}

export function RpcPerformanceChart({ data, valueKey, title }: RpcPerformanceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesMapRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const { theme } = useTheme();

  // Group data by endpoint
  const grouped = useMemo(() => {
    const map = new Map<string, { time: UTCTimestamp; value: number }[]>();
    for (const point of data) {
      if (!map.has(point.endpoint)) {
        map.set(point.endpoint, []);
      }
      map.get(point.endpoint)!.push({
        time: (new Date(point.bucket).getTime() / 1000) as UTCTimestamp,
        value: point[valueKey],
      });
    }
    return map;
  }, [data, valueKey]);

  const endpoints = useMemo(() => Array.from(grouped.keys()), [grouped]);

  // Create chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const isDark = theme === 'dark';
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: CHART_HEIGHT,
      layout: {
        background: { color: 'transparent' },
        textColor: isDark ? '#666666' : '#646464',
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: isDark ? 'rgba(0, 255, 65, 0.06)' : 'rgba(0, 143, 53, 0.08)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { visible: true, labelVisible: false, color: isDark ? 'rgba(0, 255, 65, 0.3)' : 'rgba(0, 143, 53, 0.3)' },
        horzLine: { visible: true, labelVisible: true, color: isDark ? 'rgba(0, 255, 65, 0.3)' : 'rgba(0, 143, 53, 0.3)' },
      },
    });

    chartRef.current = chart;
    seriesMapRef.current.clear();

    // Add series per endpoint
    let i = 0;
    for (const [endpoint, points] of grouped) {
      const color = ENDPOINT_COLORS[i % ENDPOINT_COLORS.length];
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        title: endpoint,
      });
      series.setData(points);
      seriesMapRef.current.set(endpoint, series);
      i++;
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (!chartContainerRef.current) return;
      try {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      } catch {
        // Chart destroyed
      }
    };
    window.addEventListener('resize', handleResize);

    const seriesMap = seriesMapRef.current;
    return () => {
      window.removeEventListener('resize', handleResize);
      seriesMap.clear();
      chart.remove();
      chartRef.current = null;
    };
  }, [theme, grouped]);

  return (
    <div>
      <h4 className="text-sm font-medium text-muted mb-2">{title}</h4>
      <div ref={chartContainerRef} className="w-full" />
      <div className="flex flex-wrap gap-3 mt-2 px-1">
        {endpoints.map((ep, i) => (
          <div key={ep} className="flex items-center gap-1.5 text-xs text-muted">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: ENDPOINT_COLORS[i % ENDPOINT_COLORS.length] }}
            />
            <span>{ep}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
