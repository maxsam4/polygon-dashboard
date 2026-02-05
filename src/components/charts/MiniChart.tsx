'use client';

import { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, LineData, UTCTimestamp, LineSeries } from 'lightweight-charts';
import { useTheme } from '../ThemeProvider';
import { CHART_COLORS } from '@/lib/constants';

interface DataPoint {
  time: number;
  value: number;
  blockNumber?: number;
  timestamp?: number; // Unix timestamp in seconds
}

interface SeriesData {
  data: DataPoint[];
  color: string;
  label?: string;
}

interface MiniChartProps {
  title: string;
  data?: DataPoint[];
  series?: SeriesData[];
  currentValue: string;
  unit: string;
  color?: string;
}

export function MiniChart({ title, data, series, currentValue, unit, color }: MiniChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const blockMapRef = useRef<Map<number, number>>(new Map());
  const { theme } = useTheme();
  const [hoveredBlock, setHoveredBlock] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  // Determine chart color based on title or prop
  // Uses centralized CHART_COLORS: PRIMARY (green) for gas/mgas, SECONDARY (cyan) for finality/tps
  const chartColor = color || (
    title.toLowerCase().includes('gas') || title.toLowerCase().includes('mgas')
      ? CHART_COLORS.PRIMARY
      : CHART_COLORS.SECONDARY
  );

  const handleChartClick = () => {
    if (hoveredBlock !== null) {
      navigator.clipboard.writeText(hoveredBlock.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  // Track if chart is valid - set to false BEFORE chart.remove() to prevent race conditions
  const isChartValidRef = useRef(true);

  // Check if we have any data to render
  const hasData = (series && series.some(s => s.data.length > 0)) || (data && data.length > 0);

  useEffect(() => {
    // Don't create chart until we have data - prevents "Value is null" errors
    if (!chartContainerRef.current || !hasData) return;

    // Mark chart as valid when creating
    isChartValidRef.current = true;

    const isDark = theme === 'dark';

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 180,
      layout: {
        background: { color: 'transparent' },
        textColor: isDark ? '#666666' : '#646464',
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: isDark ? 'rgba(0, 255, 65, 0.06)' : 'rgba(0, 143, 53, 0.08)' },
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        visible: true,
        timeVisible: false,
        tickMarkFormatter: (time: number) => {
          const now = Math.floor(Date.now() / 1000);
          const diff = now - time;
          if (diff < 60) return `${Math.round(diff)}s`;
          if (diff < 3600) return `${Math.round(diff / 60)}m`;
          return `${Math.round(diff / 3600)}h`;
        },
      },
      crosshair: {
        vertLine: { visible: true, labelVisible: false, color: isDark ? 'rgba(0, 255, 65, 0.3)' : 'rgba(0, 143, 53, 0.3)' },
        horzLine: { visible: true, labelVisible: true, color: isDark ? 'rgba(0, 255, 65, 0.3)' : 'rgba(0, 143, 53, 0.3)' },
      },
      handleScale: false,
      handleScroll: false,
    });

    // Subscribe to crosshair move to track hovered block
    chart.subscribeCrosshairMove((param) => {
      // Guard against callbacks firing during/after chart destruction
      if (!isChartValidRef.current) return;
      if (param.time !== undefined) {
        const blockNum = blockMapRef.current.get(param.time as number);
        setHoveredBlock(blockNum ?? null);
      } else {
        setHoveredBlock(null);
      }
    });

    chartRef.current = chart;
    seriesRefs.current = [];

    const handleResize = () => {
      // Guard against resize events during/after chart destruction
      if (!isChartValidRef.current || !chartContainerRef.current) return;
      try {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      } catch {
        // Chart was destroyed, ignore
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      // Mark invalid BEFORE destroying to prevent race conditions with data effect
      isChartValidRef.current = false;
      window.removeEventListener('resize', handleResize);
      // Clear series refs before removing chart - they'll be invalid after remove()
      seriesRefs.current = [];
      chart.remove();
      chartRef.current = null;
    };
  }, [theme, chartColor, hasData]);

  useEffect(() => {
    // Don't run until we have data and a valid chart
    // Check both chartRef and isChartValidRef - the latter catches race conditions
    // where the chart is being destroyed but chartRef hasn't been nulled yet
    if (!hasData || !chartRef.current || !isChartValidRef.current) return;

    // Track if this effect has been cleaned up to prevent operations on destroyed chart
    let isCleanedUp = false;

    // Helper to check if chart operations are safe
    const isChartSafe = () => !isCleanedUp && chartRef.current && isChartValidRef.current;

    // Clear existing series - wrap in try-catch as series may be from destroyed chart
    seriesRefs.current.forEach((s) => {
      try {
        if (isChartSafe()) {
          chartRef.current?.removeSeries(s);
        }
      } catch {
        // Series was from a destroyed chart, ignore
      }
    });
    seriesRefs.current = [];

    // Determine which data to use - check data.length > 0 to avoid creating series with empty arrays
    const allSeries: SeriesData[] = series || (data && data.length > 0 ? [{ data, color: chartColor }] : []);
    if (allSeries.length === 0 || allSeries.every(s => s.data.length === 0)) return;

    // Build block number map for tick formatting from first series
    blockMapRef.current.clear();
    allSeries[0].data.forEach((d) => {
      if (d.blockNumber !== undefined) {
        // Use timestamp if available for the map key
        const timeKey = d.timestamp ?? d.time;
        blockMapRef.current.set(timeKey, d.blockNumber);
      }
    });

    // Create series for each data set
    allSeries.forEach((s) => {
      // Skip empty data arrays - lightweight-charts throws "Value is null" on empty data
      if (s.data.length === 0) return;

      // Check if chart is still safe for operations
      if (!isChartSafe()) return;

      try {
        const lineSeries = chartRef.current!.addSeries(LineSeries, {
          color: s.color || chartColor,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });

        // Use actual timestamps if available, otherwise fall back to index
        // Filter out any invalid data points (NaN, null, undefined values cause "Value is null" errors)
        const chartData: LineData<UTCTimestamp>[] = s.data
          .filter((d) => {
            const time = d.timestamp ?? d.time;
            return time != null && !isNaN(time) && d.value != null && !isNaN(d.value);
          })
          .map((d) => ({
            time: (d.timestamp ?? d.time) as UTCTimestamp,
            value: d.value,
          }));

        // Skip if all data was filtered out
        if (chartData.length === 0) return;

        // Check before setData - chart may have been destroyed during map
        if (!isChartSafe()) return;

        lineSeries.setData(chartData);
        seriesRefs.current.push(lineSeries);
      } catch {
        // Chart was destroyed during operations, ignore
      }
    });

    // Fit content if chart is still valid and we have data
    if (isChartSafe() && seriesRefs.current.length > 0) {
      try {
        chartRef.current!.timeScale().fitContent();
      } catch {
        // Chart was destroyed, ignore
      }
    }

    return () => {
      isCleanedUp = true;
    };
  }, [data, series, chartColor, hasData]);

  return (
    <div className="terminal-card rounded-lg p-4 relative overflow-hidden">
      {/* Colored accent bar at top */}
      <div
        className="absolute top-0 left-0 right-0 h-0.5 rounded-t-lg"
        style={{ background: chartColor }}
      />
      <div className="flex justify-between items-start mb-2 pt-1">
        <h3 className="text-sm font-medium text-muted">{title}</h3>
        <div className="text-right">
          <span className="text-xl font-bold" style={{ color: chartColor }}>{currentValue}</span>
          <span className="text-sm text-muted ml-1">{unit}</span>
        </div>
      </div>
      <div
        ref={chartContainerRef}
        className="w-full cursor-pointer relative"
        onClick={handleChartClick}
      />
      <div className="text-xs mt-1 flex justify-between items-center h-4">
        {hoveredBlock !== null ? (
          <>
            <span className="text-muted">Block: {hoveredBlock.toLocaleString()}</span>
            {copied ? (
              <span className="text-success">Copied!</span>
            ) : (
              <span className="text-accent/60">Click to copy</span>
            )}
          </>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
    </div>
  );
}
