'use client';

interface ChartControlsProps {
  timeRange: string;
  onTimeRangeChange: (range: string) => void;
  bucketSize: string;
  onBucketSizeChange: (size: string) => void;
  seriesOptions: { key: string; label: string; enabled: boolean; color?: string }[];
  onSeriesToggle: (key: string) => void;
  customStartTime: string;
  customEndTime: string;
  onCustomStartTimeChange: (time: string) => void;
  onCustomEndTimeChange: (time: string) => void;
  onApplyCustomRange: () => void;
}

const TIME_RANGES = ['5m', '15m', '30m', '1H', '3H', '6H', '1D', '1W', '1M', '6M', '1Y', 'ALL', 'Custom'];
const BUCKET_SIZES = ['2s', '1m', '5m', '15m', '1h', '4h', '1d', '1w'];

export function ChartControls({
  timeRange,
  onTimeRangeChange,
  bucketSize,
  onBucketSizeChange,
  seriesOptions,
  onSeriesToggle,
  customStartTime,
  customEndTime,
  onCustomStartTimeChange,
  onCustomEndTimeChange,
  onApplyCustomRange,
}: ChartControlsProps) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex gap-1 flex-wrap">
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

        {seriesOptions.length > 0 && (
          <div className="flex gap-3">
            {seriesOptions.map((option) => (
              <label key={option.key} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={option.enabled}
                  onChange={() => onSeriesToggle(option.key)}
                  className="rounded"
                />
                {option.color && (
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: option.color }}
                  />
                )}
                <span className={option.enabled ? '' : 'text-gray-400'}>{option.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {timeRange === 'Custom' && (
        <div className="flex flex-wrap gap-3 items-center p-3 bg-gray-100 dark:bg-gray-800 rounded">
          <div className="flex items-center gap-2">
            <label className="text-gray-600 dark:text-gray-400">From:</label>
            <input
              type="datetime-local"
              value={customStartTime}
              onChange={(e) => onCustomStartTimeChange(e.target.value)}
              className="px-2 py-1 rounded bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-gray-600 dark:text-gray-400">To:</label>
            <input
              type="datetime-local"
              value={customEndTime}
              onChange={(e) => onCustomEndTimeChange(e.target.value)}
              className="px-2 py-1 rounded bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600"
            />
          </div>
          <button
            onClick={onApplyCustomRange}
            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
