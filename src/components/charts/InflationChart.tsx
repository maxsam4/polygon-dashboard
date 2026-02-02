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
import {
  prepareRatesForCalculation,
  calculateSupplyAt,
  calculateBucketIssuance,
  weiToPol,
  annualize,
  InflationRateParams,
} from '@/lib/inflationCalc';
import {
  CHART_COLOR_PALETTE,
  TIME_RANGE_BUCKETS,
  TIME_RANGE_SECONDS,
  GWEI_PER_POL,
  getAvailableBuckets,
  getTimeRangeSeconds,
} from '@/lib/constants';
import {
  formatDateTimeLocal,
  shouldShowDates,
  formatTimeLabel as formatTimeLabelUtil,
} from '@/lib/dateUtils';

type InflationMetric = 'issuance' | 'netInflation' | 'totalSupply';

interface InflationChartProps {
  title: string;
  metric: InflationMetric;
}

interface ChartDataPoint {
  timestamp: number;
  bucketStart: number;
  bucketEnd: number;
  issuance: number;
  burned: number;
  netInflation: number;
  totalSupply: number;
  supplyAtRangeStart: number;
}

function getRecommendedBucket(range: string): string {
  return TIME_RANGE_BUCKETS[range] ?? '1h';
}

function bucketSizeToSeconds(bucket: string): number {
  const match = bucket.match(/^(\d+)(s|m|h|d|w)$/);
  if (!match) return 3600;
  const [, num, unit] = match;
  const n = parseInt(num, 10);
  switch (unit) {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    case 'w': return n * 604800;
    default: return 3600;
  }
}

export function InflationChart({ title, metric }: InflationChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map());
  const { theme } = useTheme();

  const [timeRange, setTimeRange] = useState('1D');
  const [bucketSize, setBucketSize] = useState('15m');
  const [rates, setRates] = useState<InflationRateParams[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [burnData, setBurnData] = useState<Map<number, number>>(new Map());
  const [isZoomed, setIsZoomed] = useState(false);
  const [isDataComplete, setIsDataComplete] = useState(true);
  const timeRangeRef = useRef(timeRange);

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [customStartTime, setCustomStartTime] = useState(formatDateTimeLocal(oneHourAgo));
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

  // Fetch inflation rates (once)
  useEffect(() => {
    async function fetchRates() {
      try {
        const response = await fetch('/api/inflation-rates');
        const json = await response.json();
        if (json.rates) {
          const prepared = prepareRatesForCalculation(json.rates);
          setRates(prepared);
        }
      } catch (error) {
        console.error('Failed to fetch inflation rates:', error);
      }
    }
    fetchRates();
  }, []);

  // Fetch burn data from existing chart-data API
  const fetchBurnData = useCallback(async () => {
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

      const burnMap = new Map<number, number>();
      if (json.data) {
        for (const d of json.data) {
          // totalBaseFeeSum is in gwei, convert to POL
          burnMap.set(d.timestamp, d.totalBaseFeeSum / GWEI_PER_POL);
        }
      }
      setBurnData(burnMap);
      // Check if we received all the data or hit the limit
      if (json.pagination) {
        setIsDataComplete(json.pagination.total <= json.pagination.limit);
      } else {
        setIsDataComplete(true);
      }
    } catch (error) {
      console.error('Failed to fetch burn data:', error);
      setIsDataComplete(true);
    }
  }, [timeRange, bucketSize, appliedCustomRange]);

  useEffect(() => {
    fetchBurnData();
  }, [fetchBurnData]);

  // Calculate chart data when rates or burn data change
  useEffect(() => {
    if (rates.length === 0) return;

    // Guard: Don't recalculate if Custom is selected but not yet applied
    if (timeRange === 'Custom' && !appliedCustomRange) {
      return; // Keep existing chart data visible while user enters dates
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

    const bucketSeconds = bucketSizeToSeconds(bucketSize);
    const supplyAtRangeStart = weiToPol(calculateSupplyAt(fromTime, rates[rates.length - 1]));

    const data: ChartDataPoint[] = [];

    for (let t = fromTime; t < toTime; t += bucketSeconds) {
      const bucketEnd = Math.min(t + bucketSeconds, toTime);
      const issuanceWei = calculateBucketIssuance(t, bucketEnd, rates);
      const issuancePol = weiToPol(issuanceWei);

      // Sum all burn data within this bucket's time range
      // The chart-data API returns data at various timestamps, so we aggregate all burns in this bucket
      let burned = 0;
      for (const [burnTimestamp, burnAmount] of burnData.entries()) {
        if (burnTimestamp >= t && burnTimestamp < bucketEnd) {
          burned += burnAmount;
        }
      }

      const totalSupply = weiToPol(calculateSupplyAt(bucketEnd, rates[rates.length - 1]));

      data.push({
        timestamp: t,
        bucketStart: t,
        bucketEnd,
        issuance: issuancePol,
        burned,
        netInflation: issuancePol - burned,
        totalSupply,
        supplyAtRangeStart,
      });
    }

    setChartData(data);
  }, [rates, burnData, timeRange, bucketSize, appliedCustomRange]);

  interface SeriesOption {
    key: string;
    label: string;
    enabled: boolean;
    color: string;
    priceScaleId: 'left' | 'right';
  }

  // Series options based on metric
  const seriesOptions = useMemo((): SeriesOption[] => {
    const colors = CHART_COLOR_PALETTE;
    if (metric === 'netInflation') {
      return [
        { key: 'netInflation', label: 'Net Inflation (POL)', enabled: true, color: colors[0], priceScaleId: 'right' },
        { key: 'annualizedNetInflationPercent', label: 'Annualized %', enabled: true, color: colors[3], priceScaleId: 'left' },
        { key: 'issuance', label: 'Issuance', enabled: false, color: colors[1], priceScaleId: 'right' },
        { key: 'burned', label: 'Burned', enabled: false, color: colors[4], priceScaleId: 'right' },
      ];
    }
    if (metric === 'issuance') {
      return [
        { key: 'issuance', label: 'Issuance', enabled: true, color: colors[1], priceScaleId: 'right' },
      ];
    }
    return [
      { key: 'totalSupply', label: 'Total Supply', enabled: true, color: colors[2], priceScaleId: 'right' },
    ];
  }, [metric]);

  const [enabledSeries, setEnabledSeries] = useState<SeriesOption[]>(seriesOptions);

  useEffect(() => {
    setEnabledSeries(seriesOptions);
  }, [seriesOptions]);

  const handleSeriesToggle = (key: string) => {
    setEnabledSeries((prev) =>
      prev.map((opt) => (opt.key === key ? { ...opt, enabled: !opt.enabled } : opt))
    );
  };

  // Helper wrapper functions that use the current timeRange/appliedCustomRange from refs
  const getShowDates = (): boolean => shouldShowDates(timeRangeRef.current, appliedCustomRange);
  const formatTimeLabel = (time: number): string => formatTimeLabelUtil(time, getShowDates());

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
        vertLines: { color: theme === 'dark' ? 'rgba(123, 63, 228, 0.15)' : 'rgba(123, 63, 228, 0.1)' },
        horzLines: { color: theme === 'dark' ? 'rgba(123, 63, 228, 0.15)' : 'rgba(123, 63, 228, 0.1)' },
      },
      leftPriceScale: {
        visible: metric === 'netInflation', // Show left axis for net inflation chart (annualized %)
        borderVisible: false,
      },
      rightPriceScale: {
        visible: true,
        borderVisible: false,
        // Shows RAW POL values with comma separators (not percentages)
        // Note: Number formatting is handled by the library's default formatter
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        tickMarkFormatter: (time: number) => formatTimeLabel(time),
      },
    });

    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => setIsZoomed(true));
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric]);

  // Update theme
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        layout: { textColor: theme === 'dark' ? '#d1d5db' : '#374151' },
        grid: {
          vertLines: { color: theme === 'dark' ? 'rgba(123, 63, 228, 0.15)' : 'rgba(123, 63, 228, 0.1)' },
          horzLines: { color: theme === 'dark' ? 'rgba(123, 63, 228, 0.15)' : 'rgba(123, 63, 228, 0.1)' },
        },
      });
    }
  }, [theme]);

  // Update series data
  useEffect(() => {
    if (!chartRef.current || chartData.length === 0) return;

    seriesRefs.current.forEach((series) => chartRef.current?.removeSeries(series));
    seriesRefs.current.clear();

    enabledSeries
      .filter((opt) => opt.enabled)
      .forEach((opt) => {
        let seriesData: LineData<UTCTimestamp>[];

        if (opt.key === 'totalSupply') {
          seriesData = chartData.map((d) => ({
            time: d.timestamp as UTCTimestamp,
            value: d.totalSupply,
          }));
        } else if (opt.key === 'annualizedIssuancePercent') {
          // Calculate annualized issuance percentage
          seriesData = chartData.map((d) => {
            if (d.supplyAtRangeStart === 0) return { time: d.timestamp as UTCTimestamp, value: 0 };

            const bucketDurationSeconds = d.bucketEnd - d.bucketStart;
            const annualizedIssuance = annualize(d.issuance, bucketDurationSeconds);
            const annualizedPercent = (annualizedIssuance / d.supplyAtRangeStart) * 100;

            return { time: d.timestamp as UTCTimestamp, value: annualizedPercent };
          });
        } else if (opt.key === 'annualizedNetInflationPercent') {
          // Calculate annualized net inflation percentage
          seriesData = chartData.map((d) => {
            if (d.supplyAtRangeStart === 0) return { time: d.timestamp as UTCTimestamp, value: 0 };

            const bucketDurationSeconds = d.bucketEnd - d.bucketStart;
            const annualizedNetInflation = annualize(d.netInflation, bucketDurationSeconds);
            const annualizedPercent = (annualizedNetInflation / d.supplyAtRangeStart) * 100;

            return { time: d.timestamp as UTCTimestamp, value: annualizedPercent };
          });
        } else {
          // Handle issuance, burned, netInflation
          const isPercentSeries = opt.key.endsWith('%');
          const baseKey = isPercentSeries ? opt.key.replace('%', '') : opt.key;

          seriesData = chartData.map((d) => {
            let rawValue = baseKey === 'issuance' ? d.issuance :
                          baseKey === 'burned' ? d.burned :
                          d.netInflation;

            if (isPercentSeries && d.supplyAtRangeStart > 0) {
              rawValue = (rawValue / d.supplyAtRangeStart) * 100;
            }

            return { time: d.timestamp as UTCTimestamp, value: rawValue };
          });
        }

        const series = chartRef.current!.addSeries(LineSeries, {
          color: opt.color,
          lineWidth: 2,
          priceScaleId: opt.priceScaleId,
        });

        series.setData(seriesData);
        seriesRefs.current.set(opt.key, series);
      });

    chartRef.current.timeScale().fitContent();
  }, [chartData, enabledSeries]);

  const handleResetZoom = () => {
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
      setIsZoomed(false);
    }
  };

  // Calculate period totals (only show when data is complete)
  const periodTotals = useMemo(() => {
    if (chartData.length === 0 || !isDataComplete) return null;

    const totalIssuance = chartData.reduce((sum, d) => sum + d.issuance, 0);
    const totalBurned = chartData.reduce((sum, d) => sum + d.burned, 0);
    const netInflation = totalIssuance - totalBurned;
    const supplyAtStart = chartData[0]?.supplyAtRangeStart || 0;
    const periodSeconds = chartData.length > 0
      ? (chartData[chartData.length - 1].bucketEnd - chartData[0].bucketStart)
      : 1;

    return {
      totalIssuance,
      totalBurned,
      netInflation,
      supplyAtStart,
      periodSeconds,
      issuancePercent: supplyAtStart > 0 ? (totalIssuance / supplyAtStart) * 100 : 0,
      netInflationPercent: supplyAtStart > 0 ? (netInflation / supplyAtStart) * 100 : 0,
      annualizedIssuance: annualize(totalIssuance, periodSeconds),
      annualizedNetInflation: annualize(netInflation, periodSeconds),
      annualizedIssuancePercent: supplyAtStart > 0 ? annualize((totalIssuance / supplyAtStart) * 100, periodSeconds) : 0,
      annualizedNetInflationPercent: supplyAtStart > 0 ? annualize((netInflation / supplyAtStart) * 100, periodSeconds) : 0,
    };
  }, [chartData, isDataComplete]);

  return (
    <div className="glass-card-solid rounded-xl p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 gradient-polygon" />
      <div className="flex justify-between items-start mb-4 pt-1">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <div className="flex items-center gap-3">
          {isZoomed && (
            <button
              onClick={handleResetZoom}
              className="px-2 py-1 text-xs btn-surface rounded transition-colors"
            >
              Reset Zoom
            </button>
          )}
        </div>
      </div>

      {/* Period totals - Show both absolute (POL) and relative (%) values */}
      {periodTotals && metric !== 'totalSupply' && (
        <div className="mb-4 text-sm">
          <div className="grid grid-cols-2 gap-4 mb-2">
            <div>
              <div className="text-text-secondary mb-1">Period Total:</div>
              <div className="font-semibold text-lg text-foreground">
                {(periodTotals[metric === 'issuance' ? 'totalIssuance' : 'netInflation']).toLocaleString('en-US', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })} POL
              </div>
              <div className="text-sm text-text-secondary/70">
                ({(periodTotals[metric === 'issuance' ? 'issuancePercent' : 'netInflationPercent']).toFixed(4)}% of supply)
              </div>
            </div>
            <div>
              <div className="text-text-secondary mb-1">Annualized:</div>
              <div className="font-semibold text-lg text-foreground">
                {(periodTotals[metric === 'issuance' ? 'annualizedIssuance' : 'annualizedNetInflation']).toLocaleString('en-US', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })} POL/yr
              </div>
              <div className="text-sm text-text-secondary/70">
                ({(periodTotals[metric === 'issuance' ? 'annualizedIssuancePercent' : 'annualizedNetInflationPercent']).toFixed(2)}%/yr)
              </div>
            </div>
          </div>
        </div>
      )}

      <ChartControls
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        bucketSize={bucketSize}
        onBucketSizeChange={setBucketSize}
        seriesOptions={enabledSeries}
        onSeriesToggle={handleSeriesToggle}
        customStartTime={customStartTime}
        customEndTime={customEndTime}
        onCustomStartTimeChange={setCustomStartTime}
        onCustomEndTimeChange={setCustomEndTime}
        onApplyCustomRange={handleApplyCustomRange}
        availableBuckets={availableBuckets}
      />

      <div className="relative mt-4">
        <div ref={chartContainerRef} className="w-full" />
      </div>
    </div>
  );
}
