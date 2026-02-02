'use client';

import { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, LineData, UTCTimestamp, LineSeries } from 'lightweight-charts';
import { useTheme } from '../ThemeProvider';

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

export function MiniChart({ title, data, series, currentValue, unit, color = '#7B3FE4' }: MiniChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const blockMapRef = useRef<Map<number, number>>(new Map());
  const { theme } = useTheme();
  const [hoveredBlock, setHoveredBlock] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const handleChartClick = () => {
    if (hoveredBlock !== null) {
      navigator.clipboard.writeText(hoveredBlock.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 180,
      layout: {
        background: { color: 'transparent' },
        textColor: theme === 'dark' ? '#A8A2B6' : '#6B6280',
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: theme === 'dark' ? 'rgba(123, 63, 228, 0.1)' : 'rgba(123, 63, 228, 0.08)' },
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
        vertLine: { visible: true, labelVisible: false },
        horzLine: { visible: true, labelVisible: true },
      },
      handleScale: false,
      handleScroll: false,
    });

    // Subscribe to crosshair move to track hovered block
    chart.subscribeCrosshairMove((param) => {
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
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [theme, color]);

  useEffect(() => {
    if (!chartRef.current) return;

    // Clear existing series
    seriesRefs.current.forEach((s) => chartRef.current?.removeSeries(s));
    seriesRefs.current = [];

    // Determine which data to use
    const allSeries: SeriesData[] = series || (data ? [{ data, color }] : []);
    if (allSeries.length === 0) return;

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
      const lineSeries = chartRef.current!.addSeries(LineSeries, {
        color: s.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      // Use actual timestamps if available, otherwise fall back to index
      const chartData: LineData<UTCTimestamp>[] = s.data.map((d) => ({
        time: (d.timestamp ?? d.time) as UTCTimestamp,
        value: d.value,
      }));
      lineSeries.setData(chartData);
      seriesRefs.current.push(lineSeries);
    });

    chartRef.current.timeScale().fitContent();
  }, [data, series, color]);

  return (
    <div className="glass-card-solid rounded-xl p-4 relative overflow-hidden">
      {/* Colored accent bar at top */}
      <div
        className="accent-bar"
        style={{ background: `linear-gradient(to right, ${color}, ${color}aa)` }}
      />
      <div className="flex justify-between items-start mb-2 pt-1">
        <h3 className="text-sm font-medium text-text-secondary">{title}</h3>
        <div className="text-right">
          <span className="text-xl font-bold" style={{ color }}>{currentValue}</span>
          <span className="text-sm text-text-secondary ml-1">{unit}</span>
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
            <span className="text-text-secondary">Block: {hoveredBlock.toLocaleString()}</span>
            {copied ? (
              <span className="text-success">Copied!</span>
            ) : (
              <span className="text-polygon-purple/60">Click to copy</span>
            )}
          </>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
    </div>
  );
}
