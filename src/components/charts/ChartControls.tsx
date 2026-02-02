'use client';

import { memo } from 'react';

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
  availableBuckets?: string[];
}

const TIME_RANGES = ['5m', '15m', '30m', '1H', '3H', '6H', '1D', '1W', '1M', '6M', '1Y', 'YTD', 'ALL', 'Custom'];
const BUCKET_SIZES = ['2s', '1m', '5m', '15m', '1h', '4h', '1d', '1w'];

const ChartControlsComponent = ({
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
  availableBuckets,
}: ChartControlsProps) => {
  // Use provided available buckets or fall back to all bucket sizes
  const bucketsToShow = availableBuckets ?? BUCKET_SIZES;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex gap-1 flex-wrap">
          {TIME_RANGES.map((range) => (
            <button
              key={range}
              onClick={() => onTimeRangeChange(range)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                timeRange === range
                  ? 'btn-gradient-active'
                  : 'btn-surface'
              }`}
            >
              {range}
            </button>
          ))}
        </div>

        <select
          value={bucketSize}
          onChange={(e) => onBucketSizeChange(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg bg-surface dark:bg-surface-elevated border border-polygon-purple/20 text-foreground focus:outline-none focus:ring-2 focus:ring-polygon-purple/50 transition-all"
        >
          {bucketsToShow.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>

        {seriesOptions.length > 0 && (
          <div className="flex gap-3">
            {seriesOptions.map((option) => (
              <label key={option.key} className="flex items-center gap-1.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={option.enabled}
                  onChange={() => onSeriesToggle(option.key)}
                  className="rounded border-polygon-purple/30 text-polygon-purple focus:ring-polygon-purple/50 bg-surface"
                />
                {option.color && (
                  <span
                    className="w-3 h-3 rounded-full ring-1 ring-white/20"
                    style={{ backgroundColor: option.color }}
                  />
                )}
                <span className={`transition-colors ${option.enabled ? 'text-foreground' : 'text-text-secondary'} group-hover:text-foreground`}>
                  {option.label}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {timeRange === 'Custom' && (
        <div className="flex flex-wrap gap-3 items-center p-3 glass-card rounded-lg">
          <div className="flex items-center gap-2">
            <label className="text-text-secondary">From:</label>
            <input
              type="datetime-local"
              value={customStartTime}
              onChange={(e) => onCustomStartTimeChange(e.target.value)}
              className="px-2 py-1 rounded-lg bg-surface dark:bg-surface-elevated border border-polygon-purple/20 text-foreground focus:outline-none focus:ring-2 focus:ring-polygon-purple/50"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-text-secondary">To:</label>
            <input
              type="datetime-local"
              value={customEndTime}
              onChange={(e) => onCustomEndTimeChange(e.target.value)}
              className="px-2 py-1 rounded-lg bg-surface dark:bg-surface-elevated border border-polygon-purple/20 text-foreground focus:outline-none focus:ring-2 focus:ring-polygon-purple/50"
            />
          </div>
          <button
            onClick={onApplyCustomRange}
            className="px-4 py-1.5 btn-gradient-active rounded-lg text-sm"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
};

export const ChartControls = memo(ChartControlsComponent);
