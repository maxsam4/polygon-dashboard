'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
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
import { ChartDataPoint } from '@/lib/types';
import { formatPol } from '@/lib/utils';
import { GWEI_PER_POL, CHART_COLORS } from '@/lib/constants';
import {
  shouldShowDates,
  formatTimeLabel as formatTimeLabelUtil,
  formatTooltipTime as formatTooltipTimeUtil,
} from '@/lib/dateUtils';
import { useSharedChartData } from '@/contexts/ChartDataContext';
import { ChartControls } from './ChartControls';

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
  { value: 'finalityAvg', label: 'Finality Time Avg (s)' },
  { value: 'finalityMin', label: 'Finality Time Min (s)' },
  { value: 'finalityMax', label: 'Finality Time Max (s)' },
  { value: 'blockTimeAvg', label: 'Bor Block Time Avg (s)' },
  { value: 'blockTimeMin', label: 'Bor Block Time Min (s)' },
  { value: 'blockTimeMax', label: 'Bor Block Time Max (s)' },
] as const;

type DataOptionValue = (typeof DATA_OPTIONS)[number]['value'];

interface SharedCustomizableChartProps {
  title: string;
  defaultLeftSeries: DataOptionValue;
  defaultRightSeries: DataOptionValue;
  dualAxis: boolean;
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
    case 'finalityAvg':
      return d.finalityAvg ?? 0;
    case 'finalityMin':
      return d.finalityMin ?? 0;
    case 'finalityMax':
      return d.finalityMax ?? 0;
    case 'blockTimeAvg':
      return d.blockTimeAvg ?? 0;
    case 'blockTimeMin':
      return d.blockTimeMin ?? 0;
    case 'blockTimeMax':
      return d.blockTimeMax ?? 0;
    default:
      return 0;
  }
}

function isCumulativeSeries(series: DataOptionValue): boolean {
  return series === 'cumulativeBaseFee' || series === 'cumulativePriorityFee' || series === 'cumulativeTotalFee';
}

export function SharedCustomizableChart({
  title,
  defaultLeftSeries,
  defaultRightSeries,
  dualAxis,
}: SharedCustomizableChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map());
  const { theme } = useTheme();

  // Get shared data from context
  const {
    chartData: data,
    isDataComplete,
    timeRangeBounds,
    timeRange,
    setTimeRange,
    bucketSize,
    setBucketSize,
    availableBuckets,
    appliedCustomRange,
    customStartTime,
    setCustomStartTime,
    customEndTime,
    setCustomEndTime,
    applyCustomRange,
  } = useSharedChartData();

  const [isZoomed, setIsZoomed] = useState(false);
  const [leftSeries, setLeftSeries] = useState<DataOptionValue>(defaultLeftSeries);
  const [rightSeries, setRightSeries] = useState<DataOptionValue>(defaultRightSeries);

  // Helper wrapper functions
  const getShowDates = (): boolean => shouldShowDates(timeRange, appliedCustomRange);
  const formatTimeLabel = (time: number): string => formatTimeLabelUtil(time, getShowDates());
  const formatTooltipTime = (timestamp: number): string => formatTooltipTimeUtil(timestamp, getShowDates());

  // Create chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const isDark = theme === 'dark';

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 300,
      layout: {
        background: { color: 'transparent' },
        textColor: isDark ? '#666666' : '#646464',
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(0, 255, 65, 0.06)' : 'rgba(0, 143, 53, 0.08)' },
        horzLines: { color: isDark ? 'rgba(0, 255, 65, 0.06)' : 'rgba(0, 143, 53, 0.08)' },
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
      chartRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dualAxis]);

  // Update theme colors
  useEffect(() => {
    if (chartRef.current) {
      const isDark = theme === 'dark';
      chartRef.current.applyOptions({
        layout: {
          textColor: isDark ? '#666666' : '#646464',
        },
        grid: {
          vertLines: { color: isDark ? 'rgba(0, 255, 65, 0.06)' : 'rgba(0, 143, 53, 0.08)' },
          horzLines: { color: isDark ? 'rgba(0, 255, 65, 0.06)' : 'rgba(0, 143, 53, 0.08)' },
        },
      });
    }
  }, [theme]);

  // Update series data
  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;

    let isCleanedUp = false;

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

    if (isCleanedUp || !chartRef.current) return;

    const leftSeriesObj = chartRef.current.addSeries(LineSeries, {
      color: CHART_COLORS.PRIMARY,
      lineWidth: 2,
      priceScaleId: 'left',
    });

    if (isCleanedUp || !chartRef.current) return;
    leftSeriesObj.setData(leftSeriesData);
    seriesRefs.current.set('left', leftSeriesObj);

    // Create right series
    const rightSeriesData: LineData<UTCTimestamp>[] = data.map((d, i) => ({
      time: d.timestamp as UTCTimestamp,
      value: getSeriesValue(d, rightSeries, cumulativeValues[i].cumulativeBaseFee, cumulativeValues[i].cumulativePriorityFee),
    }));

    if (isCleanedUp || !chartRef.current) return;

    const rightSeriesObj = chartRef.current.addSeries(LineSeries, {
      color: CHART_COLORS.SECONDARY,
      lineWidth: 2,
      priceScaleId: dualAxis ? 'right' : 'left',
    });

    if (isCleanedUp || !chartRef.current) return;
    rightSeriesObj.setData(rightSeriesData);
    seriesRefs.current.set('right', rightSeriesObj);

    if (isCleanedUp || !chartRef.current) return;

    if (timeRangeBounds) {
      chartRef.current.timeScale().setVisibleRange({
        from: timeRangeBounds.from as UTCTimestamp,
        to: timeRangeBounds.to as UTCTimestamp,
      });
    } else {
      chartRef.current.timeScale().fitContent();
    }

    return () => {
      isCleanedUp = true;
    };
  }, [data, leftSeries, rightSeries, dualAxis, timeRangeBounds]);

  const handleResetZoom = () => {
    if (chartRef.current) {
      if (timeRangeBounds) {
        chartRef.current.timeScale().setVisibleRange({
          from: timeRangeBounds.from as UTCTimestamp,
          to: timeRangeBounds.to as UTCTimestamp,
        });
      } else {
        chartRef.current.timeScale().fitContent();
      }
      setIsZoomed(false);
    }
  };

  // Calculate cumulative totals for display
  const cumulativeTotals = useMemo(() => {
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
  }, [data, isDataComplete, leftSeries, rightSeries]);

  const formatFeeAsPol = (gweiValue: number): string => {
    return formatPol(gweiValue / GWEI_PER_POL);
  };

  return (
    <div className="glass-card-solid rounded-xl p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 gradient-polygon" />
      <div className="flex justify-between items-start mb-4 pt-1">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <div className="flex flex-col items-end gap-2">
          {/* Cumulative totals display */}
          {(cumulativeTotals.baseFee !== null || cumulativeTotals.priorityFee !== null || cumulativeTotals.totalFee !== null) && (
            <div className="text-right text-sm">
              {cumulativeTotals.baseFee !== null && (
                <div>
                  <span className="text-muted">Base Fee: </span>
                  <span className="font-semibold text-accent">
                    {formatFeeAsPol(cumulativeTotals.baseFee)} POL
                  </span>
                </div>
              )}
              {cumulativeTotals.priorityFee !== null && (
                <div>
                  <span className="text-muted">Priority Fee: </span>
                  <span className="font-semibold text-accent-secondary">
                    {formatFeeAsPol(cumulativeTotals.priorityFee)} POL
                  </span>
                </div>
              )}
              {cumulativeTotals.totalFee !== null && (
                <div>
                  <span className="text-muted">Total Fee: </span>
                  <span className="font-semibold text-success">
                    {formatFeeAsPol(cumulativeTotals.totalFee)} POL
                  </span>
                </div>
              )}
            </div>
          )}
          {isZoomed && (
            <button
              onClick={handleResetZoom}
              className="px-2 py-1 text-xs btn-surface rounded transition-colors"
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
            className="text-sm rounded-lg px-2 py-1 bg-surface dark:bg-surface-elevated border border-accent/20 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            {DATA_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">(Left axis)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHART_COLORS.SECONDARY }} />
          <select
            value={rightSeries}
            onChange={(e) => setRightSeries(e.target.value as DataOptionValue)}
            className="text-sm rounded-lg px-2 py-1 bg-surface dark:bg-surface-elevated border border-accent/20 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            {DATA_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">({dualAxis ? 'Right' : 'Left'} axis)</span>
        </div>
      </div>

      <ChartControls
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        bucketSize={bucketSize}
        onBucketSizeChange={setBucketSize}
        seriesOptions={[]}
        onSeriesToggle={() => {}}
        customStartTime={customStartTime}
        customEndTime={customEndTime}
        onCustomStartTimeChange={setCustomStartTime}
        onCustomEndTimeChange={setCustomEndTime}
        onApplyCustomRange={applyCustomRange}
        availableBuckets={availableBuckets}
      />

      <div ref={chartContainerRef} className="w-full mt-4 cursor-crosshair" title="Scroll to zoom, drag to pan" />
    </div>
  );
}
