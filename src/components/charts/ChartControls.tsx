'use client';

interface ChartControlsProps {
  timeRange: string;
  onTimeRangeChange: (range: string) => void;
  bucketSize: string;
  onBucketSizeChange: (size: string) => void;
  chartType: string;
  onChartTypeChange: (type: string) => void;
  seriesOptions: { key: string; label: string; enabled: boolean }[];
  onSeriesToggle: (key: string) => void;
}

const TIME_RANGES = ['1H', '6H', '1D', '1W', '1M', '6M', '1Y', 'ALL'];
const BUCKET_SIZES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
const CHART_TYPES = ['Line', 'Candle', 'Area', 'Bar'];

export function ChartControls({
  timeRange,
  onTimeRangeChange,
  bucketSize,
  onBucketSizeChange,
  chartType,
  onChartTypeChange,
  seriesOptions,
  onSeriesToggle,
}: ChartControlsProps) {
  return (
    <div className="flex flex-wrap gap-4 items-center text-sm">
      <div className="flex gap-1">
        {TIME_RANGES.map((range) => (
          <button
            key={range}
            onClick={() => onTimeRangeChange(range)}
            className={`px-2 py-1 rounded ${
              timeRange === range
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            {range}
          </button>
        ))}
      </div>

      <select
        value={bucketSize}
        onChange={(e) => onBucketSizeChange(e.target.value)}
        className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-700"
      >
        {BUCKET_SIZES.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>

      <select
        value={chartType}
        onChange={(e) => onChartTypeChange(e.target.value)}
        className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-700"
      >
        {CHART_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>

      <div className="flex gap-2">
        {seriesOptions.map((option) => (
          <label key={option.key} className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={option.enabled}
              onChange={() => onSeriesToggle(option.key)}
              className="rounded"
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}
