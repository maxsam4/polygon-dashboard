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
  MouseEventParams,
} from 'lightweight-charts';
import { useTheme } from '../ThemeProvider';
import { ChartTooltip, TooltipContent } from './ChartTooltip';
import { ChartDataPoint, MilestoneChartDataPoint } from '@/lib/types';
import { formatPol } from '@/lib/utils';
import { GWEI_PER_POL, CHART_COLOR_PALETTE, UI_CONSTANTS } from '@/lib/constants';
import {
  shouldShowDates,
  formatTimeLabel as formatTimeLabelUtil,
  formatTooltipTime as formatTooltipTimeUtil,
  formatFullDateTime,
} from '@/lib/dateUtils';
import {
  ChartMetric,
  getSeriesOptionsForMetric,
  getBlockRangeInfo,
} from '@/lib/chartSeriesConfig';
import { useSharedChartData } from '@/contexts/ChartDataContext';
import { ChartControls } from './ChartControls';

interface SharedFullChartProps {
  title: string;
  metric: ChartMetric;
  showCumulative?: boolean;
}

type ChartData = ChartDataPoint | MilestoneChartDataPoint;

function isChartDataPoint(data: ChartData): data is ChartDataPoint {
  return 'baseFee' in data;
}

export function SharedFullChart({ title, metric, showCumulative = false }: SharedFullChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map());
  const tooltipRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  // Get shared data from context
  const {
    chartData,
    milestoneData,
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

  // Select appropriate data based on metric
  const data: ChartData[] = useMemo(() => {
    return metric === 'heimdallBlockTime' ? milestoneData : chartData;
  }, [metric, chartData, milestoneData]);

  const [isZoomed, setIsZoomed] = useState(false);

  // Tooltip state
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipContent, setTooltipContent] = useState<TooltipContent | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  // Helper wrapper functions
  const getShowDates = (): boolean => shouldShowDates(timeRange, appliedCustomRange);
  const formatTimeLabel = (time: number): string => formatTimeLabelUtil(time, getShowDates());
  const formatTooltipTime = (timestamp: number): string => formatTooltipTimeUtil(timestamp, getShowDates());

  const [seriesOptions, setSeriesOptions] = useState(() =>
    getSeriesOptionsForMetric(metric, showCumulative)
  );

  // Current hovered data point for click handling
  const hoveredDataPointRef = useRef<ChartData | null>(null);

  // Handle clicking on chart to copy block range
  const handleChartClick = useCallback(() => {
    if (!hoveredDataPointRef.current) return;

    const blockInfo = getBlockRangeInfo(metric, hoveredDataPointRef.current);
    if (blockInfo) {
      navigator.clipboard.writeText(blockInfo.copyValue).then(() => {
        const tooltip = tooltipRef.current;
        if (tooltip) {
          tooltip.style.backgroundColor = theme === 'dark' ? 'rgba(0, 255, 65, 0.15)' : 'rgba(0, 143, 53, 0.15)';
          setTimeout(() => {
            if (tooltip) {
              tooltip.style.backgroundColor = '';
            }
          }, 200);
        }
      });
    }
  }, [metric, theme]);

  // Handle crosshair move for custom tooltip
  const handleCrosshairMove = useCallback((param: MouseEventParams) => {
    if (!chartContainerRef.current || !param.time || !param.point) {
      setTooltipVisible(false);
      hoveredDataPointRef.current = null;
      return;
    }

    const timestamp = param.time as number;
    const dataPoint = data.find((d) => d.timestamp === timestamp);

    if (!dataPoint) {
      setTooltipVisible(false);
      hoveredDataPointRef.current = null;
      return;
    }

    hoveredDataPointRef.current = dataPoint;

    // Build tooltip content
    const values: { label: string; value: string; color: string }[] = [];

    seriesOptions
      .filter((opt) => opt.enabled)
      .forEach((opt) => {
        let value: number | null = null;

        if (metric === 'borBlockTime' || metric === 'heimdallBlockTime') {
          if (opt.key === 'avg') value = dataPoint.blockTimeAvg;
          else if (opt.key === 'min') value = dataPoint.blockTimeMin;
          else if (opt.key === 'max') value = dataPoint.blockTimeMax;
        } else if (metric === 'gas' && isChartDataPoint(dataPoint)) {
          if (opt.key === 'base') value = dataPoint.baseFee.avg;
          else if (opt.key === 'medianPriority') value = dataPoint.priorityFee.median;
          else if (opt.key === 'minPriority') value = dataPoint.priorityFee.min;
          else if (opt.key === 'maxPriority') value = dataPoint.priorityFee.max;
          else if (opt.key === 'total') value = dataPoint.total.avg;
        }

        if (value !== null && value !== undefined) {
          values.push({
            label: opt.label,
            value: value.toFixed(2) + (metric === 'borBlockTime' || metric === 'heimdallBlockTime' ? 's' : ' Gwei'),
            color: opt.color,
          });
        }
      });

    const blockInfo = getBlockRangeInfo(metric, dataPoint);

    setTooltipContent({
      time: formatFullDateTime(timestamp),
      blockRange: blockInfo?.display,
      values,
    });

    // Position tooltip
    const containerRect = chartContainerRef.current.getBoundingClientRect();
    let x = param.point.x + UI_CONSTANTS.TOOLTIP_OFFSET;
    let y = param.point.y - 10;

    if (x + UI_CONSTANTS.TOOLTIP_WIDTH > containerRect.width) {
      x = param.point.x - UI_CONSTANTS.TOOLTIP_WIDTH - UI_CONSTANTS.TOOLTIP_OFFSET;
    }
    if (y + UI_CONSTANTS.TOOLTIP_HEIGHT > containerRect.height) {
      y = containerRect.height - UI_CONSTANTS.TOOLTIP_HEIGHT;
    }
    if (y < 0) y = 0;

    setTooltipPosition({ x, y });
    setTooltipVisible(true);
  }, [data, metric, seriesOptions]);

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
      chartRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric]);

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

  // Subscribe to crosshair move for custom tooltip
  useEffect(() => {
    if (!chartRef.current) return;

    chartRef.current.subscribeCrosshairMove(handleCrosshairMove);

    return () => {
      chartRef.current?.unsubscribeCrosshairMove(handleCrosshairMove);
    };
  }, [handleCrosshairMove]);

  // Update series data
  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;

    let isCleanedUp = false;

    // Clear existing series
    seriesRefs.current.forEach((series) => chartRef.current?.removeSeries(series));
    seriesRefs.current.clear();

    seriesOptions
      .filter((opt) => opt.enabled)
      .forEach((opt) => {
        if (isCleanedUp || !chartRef.current) return;

        const color = opt.color || CHART_COLOR_PALETTE[0];
        let seriesData: LineData<UTCTimestamp>[];

        const blockData = data as ChartDataPoint[];

        if (metric === 'gas') {
          seriesData = blockData.map((d) => {
            const value =
              opt.key === 'base' ? d.baseFee.avg :
              opt.key === 'medianPriority' ? d.priorityFee.median :
              opt.key === 'total' ? d.total.avg :
              opt.key === 'minPriority' ? d.priorityFee.min :
              d.priorityFee.max;
            return { time: d.timestamp as UTCTimestamp, value };
          });
        } else if (metric === 'finality') {
          seriesData = blockData
            .filter((d) => {
              return opt.key === 'avg' ? d.finalityAvg !== null :
                     opt.key === 'min' ? d.finalityMin !== null :
                     d.finalityMax !== null;
            })
            .map((d) => {
              const value =
                opt.key === 'avg' ? d.finalityAvg! :
                opt.key === 'min' ? d.finalityMin! :
                d.finalityMax!;
              return { time: d.timestamp as UTCTimestamp, value };
            });
        } else if (metric === 'mgas') {
          seriesData = blockData.map((d) => ({ time: d.timestamp as UTCTimestamp, value: d.mgasPerSec }));
        } else if (metric === 'tps') {
          seriesData = blockData.map((d) => ({ time: d.timestamp as UTCTimestamp, value: d.tps }));
        } else if (metric === 'totalBaseFee') {
          if (opt.key === 'cumulative') {
            let cumulative = 0;
            seriesData = blockData.map((d) => {
              cumulative += d.totalBaseFeeSum;
              return { time: d.timestamp as UTCTimestamp, value: cumulative / GWEI_PER_POL };
            });
          } else {
            seriesData = blockData.map((d) => ({ time: d.timestamp as UTCTimestamp, value: d.totalBaseFeeSum / GWEI_PER_POL }));
          }
        } else if (metric === 'totalPriorityFee') {
          if (opt.key === 'cumulative') {
            let cumulative = 0;
            seriesData = blockData.map((d) => {
              cumulative += d.totalPriorityFeeSum;
              return { time: d.timestamp as UTCTimestamp, value: cumulative / GWEI_PER_POL };
            });
          } else {
            seriesData = blockData.map((d) => ({ time: d.timestamp as UTCTimestamp, value: d.totalPriorityFeeSum / GWEI_PER_POL }));
          }
        } else if (metric === 'totalFee') {
          if (opt.key === 'cumulative') {
            let cumulative = 0;
            seriesData = blockData.map((d) => {
              cumulative += d.totalBaseFeeSum + d.totalPriorityFeeSum;
              return { time: d.timestamp as UTCTimestamp, value: cumulative / GWEI_PER_POL };
            });
          } else {
            seriesData = blockData.map((d) => ({ time: d.timestamp as UTCTimestamp, value: (d.totalBaseFeeSum + d.totalPriorityFeeSum) / GWEI_PER_POL }));
          }
        } else if (metric === 'blockLimit') {
          seriesData = blockData.map((d) => ({
            time: d.timestamp as UTCTimestamp,
            value: d.gasLimitSum / (d.blockEnd - d.blockStart + 1) / 1_000_000,
          }));
        } else if (metric === 'blockLimitUtilization') {
          seriesData = blockData.map((d) => ({
            time: d.timestamp as UTCTimestamp,
            value: d.gasLimitSum > 0 ? (d.gasUsedSum / d.gasLimitSum) * 100 : 0,
          }));
        } else if (metric === 'borBlockTime' || metric === 'heimdallBlockTime') {
          seriesData = data
            .filter((d) => d.blockTimeAvg !== null)
            .map((d) => {
              const value =
                opt.key === 'avg' ? d.blockTimeAvg! :
                opt.key === 'min' ? (d.blockTimeMin ?? d.blockTimeAvg!) :
                (d.blockTimeMax ?? d.blockTimeAvg!);
              return { time: d.timestamp as UTCTimestamp, value };
            });
        } else {
          seriesData = blockData.map((d) => ({ time: d.timestamp as UTCTimestamp, value: d.tps }));
        }

        if (isCleanedUp || !chartRef.current) return;

        const series = chartRef.current.addSeries(LineSeries, {
          color,
          lineWidth: 2,
          priceScaleId: 'left',
        });

        if (isCleanedUp || !chartRef.current) return;

        series.setData(seriesData);
        seriesRefs.current.set(opt.key, series);
      });

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
  }, [data, seriesOptions, metric, timeRangeBounds]);

  const handleSeriesToggle = (key: string) => {
    setSeriesOptions((prev) =>
      prev.map((opt) => (opt.key === key ? { ...opt, enabled: !opt.enabled } : opt))
    );
  };

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

  // Calculate period total for cumulative fee charts
  const periodTotal = (() => {
    if (!showCumulative || data.length === 0 || !isDataComplete) return null;
    const blockData = data as ChartDataPoint[];
    if (metric === 'totalBaseFee') {
      return blockData.reduce((sum, d) => sum + d.totalBaseFeeSum, 0);
    }
    if (metric === 'totalPriorityFee') {
      return blockData.reduce((sum, d) => sum + d.totalPriorityFeeSum, 0);
    }
    if (metric === 'totalFee') {
      return blockData.reduce((sum, d) => sum + d.totalBaseFeeSum + d.totalPriorityFeeSum, 0);
    }
    return null;
  })();

  const formatFeeAsPol = (gweiValue: number): string => {
    return formatPol(gweiValue / GWEI_PER_POL);
  };

  return (
    <div className="terminal-card rounded-lg p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent rounded-t-lg" />
      <div className="flex justify-between items-center mb-4 pt-1">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <div className="flex items-center gap-3">
          {periodTotal !== null && (
            <div className="text-right">
              <span className="text-sm text-muted">Period Total: </span>
              <span className="text-lg font-semibold text-accent">
                {formatFeeAsPol(periodTotal)} POL
              </span>
            </div>
          )}
          {isZoomed && (
            <button
              onClick={handleResetZoom}
              className="px-3 py-1.5 text-xs terminal-btn rounded transition-all"
              title="Reset zoom to show all data"
            >
              Reset Zoom
            </button>
          )}
        </div>
      </div>

      <ChartControls
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        bucketSize={bucketSize}
        onBucketSizeChange={setBucketSize}
        seriesOptions={seriesOptions}
        onSeriesToggle={handleSeriesToggle}
        customStartTime={customStartTime}
        customEndTime={customEndTime}
        onCustomStartTimeChange={setCustomStartTime}
        onCustomEndTimeChange={setCustomEndTime}
        onApplyCustomRange={applyCustomRange}
        availableBuckets={availableBuckets}
      />

      <div className="relative mt-4">
        <div
          ref={chartContainerRef}
          className="w-full cursor-crosshair"
          title="Scroll to zoom, drag to pan. Click to copy block range."
          onClick={handleChartClick}
        />
        <ChartTooltip
          ref={tooltipRef}
          visible={tooltipVisible}
          content={tooltipContent}
          position={tooltipPosition}
        />
      </div>
    </div>
  );
}
