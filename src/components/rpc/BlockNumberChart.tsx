'use client';

import { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, LineSeries, UTCTimestamp } from 'lightweight-charts';
import { useTheme } from '@/components/ThemeProvider';
import { BlockHistoryPoint } from '@/hooks/useRpcPolling';

const CHART_HEIGHT = 250;
const ENDPOINT_COLORS = [
  '#00FF41', '#00D4FF', '#FFB800', '#FF3B3B',
  '#A855F7', '#F97316', '#14B8A6', '#EC4899',
];

function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return url.slice(0, 30);
  }
}

interface BlockNumberChartProps {
  history: Map<string, BlockHistoryPoint[]>;
  urls: string[];
}

export function BlockNumberChart({ history, urls }: BlockNumberChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesMapRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const isChartValidRef = useRef(true);
  const { theme } = useTheme();

  // Create chart
  useEffect(() => {
    if (!chartContainerRef.current) return;
    isChartValidRef.current = true;

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
        secondsVisible: true,
      },
      crosshair: {
        vertLine: { visible: true, labelVisible: false, color: isDark ? 'rgba(0, 255, 65, 0.3)' : 'rgba(0, 143, 53, 0.3)' },
        horzLine: { visible: true, labelVisible: true, color: isDark ? 'rgba(0, 255, 65, 0.3)' : 'rgba(0, 143, 53, 0.3)' },
      },
    });

    chartRef.current = chart;
    seriesMapRef.current.clear();

    const handleResize = () => {
      if (!isChartValidRef.current || !chartContainerRef.current) return;
      try {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      } catch {
        // Chart destroyed
      }
    };
    window.addEventListener('resize', handleResize);

    const seriesMap = seriesMapRef.current;
    return () => {
      isChartValidRef.current = false;
      window.removeEventListener('resize', handleResize);
      seriesMap.clear();
      chart.remove();
      chartRef.current = null;
    };
  }, [theme]);

  // Update data
  useEffect(() => {
    if (!chartRef.current || !isChartValidRef.current) return;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const points = history.get(url);
      if (!points || points.length === 0) continue;

      const color = ENDPOINT_COLORS[i % ENDPOINT_COLORS.length];
      let series = seriesMapRef.current.get(url);

      if (!series) {
        try {
          series = chartRef.current!.addSeries(LineSeries, {
            color,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          seriesMapRef.current.set(url, series);
        } catch {
          continue;
        }
      }

      try {
        const lastPoint = points[points.length - 1];
        series.update({
          time: lastPoint.time as UTCTimestamp,
          value: lastPoint.block,
        });
      } catch {
        // Chart destroyed
      }
    }

    // Auto-scroll
    try {
      if (isChartValidRef.current) {
        chartRef.current!.timeScale().scrollToRealTime();
      }
    } catch {
      // Ignore
    }
  }, [history, urls]);

  return (
    <div>
      <div ref={chartContainerRef} className="w-full" />
      <div className="flex flex-wrap gap-3 mt-2 px-1">
        {urls.map((url, i) => (
          <div key={url} className="flex items-center gap-1.5 text-xs text-muted">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: ENDPOINT_COLORS[i % ENDPOINT_COLORS.length] }}
            />
            <span className="truncate max-w-[150px]" title={url}>{truncateUrl(url)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
