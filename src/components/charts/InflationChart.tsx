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
} from '@/lib/constants';

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

function formatDateTimeLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
  const timeRangeRef = useRef(timeRange);

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [customStartTime, setCustomStartTime] = useState(formatDateTimeLocal(oneHourAgo));
  const [customEndTime, setCustomEndTime] = useState(formatDateTimeLocal(now));
  const [appliedCustomRange, setAppliedCustomRange] = useState<{ start: number; end: number } | null>(null);

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
      const response = await fetch(
        `/api/chart-data?fromTime=${fromTime}&toTime=${toTime}&bucketSize=${bucketSize}&limit=5000`
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
    } catch (error) {
      console.error('Failed to fetch burn data:', error);
    }
  }, [timeRange, bucketSize, appliedCustomRange]);

  useEffect(() => {
    fetchBurnData();
  }, [fetchBurnData]);

  // Calculate chart data when rates or burn data change
  useEffect(() => {
    if (rates.length === 0) return;

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

  // Series options based on metric - raw values only
  const seriesOptions = useMemo((): SeriesOption[] => {
    const colors = CHART_COLOR_PALETTE;
    if (metric === 'netInflation') {
      return [
        { key: 'netInflation', label: 'Net Inflation', enabled: true, color: colors[0], priceScaleId: 'right' },
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

  const shouldShowDates = (range: string): boolean => {
    if (range === 'Custom' && appliedCustomRange) {
      return (appliedCustomRange.end - appliedCustomRange.start) > 86400;
    }
    const longRanges = ['1D', '1W', '1M', '6M', '1Y', 'ALL'];
    return longRanges.includes(range);
  };

  const formatTimeLabel = (time: number): string => {
    const date = new Date(time * 1000);
    if (shouldShowDates(timeRangeRef.current)) {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

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
      leftPriceScale: {
        visible: false,
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
  }, []);

  // Update theme
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        layout: { textColor: theme === 'dark' ? '#d1d5db' : '#374151' },
        grid: {
          vertLines: { color: theme === 'dark' ? '#374151' : '#e5e7eb' },
          horzLines: { color: theme === 'dark' ? '#374151' : '#e5e7eb' },
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

        const isPercentSeries = opt.key.endsWith('%');
        const baseKey = isPercentSeries ? opt.key.replace('%', '') : opt.key;

        if (baseKey === 'totalSupply') {
          seriesData = chartData.map((d) => ({
            time: d.timestamp as UTCTimestamp,
            value: d.totalSupply,
          }));
        } else {
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

  // Calculate period totals
  const periodTotals = useMemo(() => {
    if (chartData.length === 0) return null;

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
  }, [chartData]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-4">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold">{title}</h3>
        <div className="flex items-center gap-3">
          {isZoomed && (
            <button
              onClick={handleResetZoom}
              className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded"
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
              <div className="text-gray-500 dark:text-gray-400 mb-1">Period Total:</div>
              <div className="font-semibold text-lg">
                {(periodTotals[metric === 'issuance' ? 'totalIssuance' : 'netInflation']).toLocaleString('en-US', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })} POL
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                ({(periodTotals[metric === 'issuance' ? 'issuancePercent' : 'netInflationPercent']).toFixed(4)}% of supply)
              </div>
            </div>
            <div>
              <div className="text-gray-500 dark:text-gray-400 mb-1">Annualized:</div>
              <div className="font-semibold text-lg">
                {(periodTotals[metric === 'issuance' ? 'annualizedIssuance' : 'annualizedNetInflation']).toLocaleString('en-US', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })} POL/yr
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
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
      />

      <div className="relative mt-4">
        <div ref={chartContainerRef} className="w-full" />
      </div>
    </div>
  );
}
