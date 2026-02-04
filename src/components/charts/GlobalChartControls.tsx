'use client';

import { useSharedChartData } from '@/contexts/ChartDataContext';
import { ALL_TIME_RANGES, ALL_BUCKET_SIZES } from '@/lib/constants';

export function GlobalChartControls() {
  const {
    timeRange,
    setTimeRange,
    bucketSize,
    setBucketSize,
    availableBuckets,
    customStartTime,
    setCustomStartTime,
    customEndTime,
    setCustomEndTime,
    applyCustomRange,
    isLoading,
  } = useSharedChartData();

  return (
    <div className="glass-card-solid rounded-xl p-4 mb-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Time Range:</span>
          <div className="flex flex-wrap gap-1">
            {ALL_TIME_RANGES.map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                  timeRange === range
                    ? 'bg-accent text-white font-medium'
                    : 'bg-surface hover:bg-surface-elevated text-foreground'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Bucket:</span>
          <select
            value={bucketSize}
            onChange={(e) => setBucketSize(e.target.value)}
            className="text-sm rounded-lg px-2 py-1.5 bg-surface dark:bg-surface-elevated border border-accent/20 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            {ALL_BUCKET_SIZES.map((size) => (
              <option key={size} value={size} disabled={!availableBuckets.includes(size)}>
                {size}
              </option>
            ))}
          </select>
        </div>

        {timeRange === 'Custom' && (
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={customStartTime}
              onChange={(e) => setCustomStartTime(e.target.value)}
              className="text-sm rounded-lg px-2 py-1 bg-surface dark:bg-surface-elevated border border-accent/20 text-foreground"
            />
            <span className="text-muted">to</span>
            <input
              type="datetime-local"
              value={customEndTime}
              onChange={(e) => setCustomEndTime(e.target.value)}
              className="text-sm rounded-lg px-2 py-1 bg-surface dark:bg-surface-elevated border border-accent/20 text-foreground"
            />
            <button
              onClick={applyCustomRange}
              className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors"
            >
              Apply
            </button>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            Loading...
          </div>
        )}
      </div>
    </div>
  );
}
