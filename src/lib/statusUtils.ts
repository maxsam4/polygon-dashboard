/**
 * Status page utility functions.
 * Centralized formatting and calculation utilities for the status dashboard.
 */

/**
 * Format seconds into a human-readable age string.
 * @param seconds - Number of seconds
 * @returns Formatted string like "5s", "3m 45s", or "2h 15m"
 */
export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/**
 * Format an ISO timestamp string as "X ago".
 * @param isoString - ISO date string or null
 * @returns "X ago" string or "Never" if null
 */
export function formatTimeAgo(isoString: string | null): string {
  if (!isoString) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  return formatAge(seconds) + ' ago';
}

/**
 * Format a number with locale-specific thousands separators.
 * @param num - Number or string to format
 * @returns Formatted number string
 */
export function formatNumber(num: number | string): string {
  const n = typeof num === 'string' ? parseInt(num, 10) : num;
  return n.toLocaleString();
}

/**
 * Format a date range from two ISO timestamp strings.
 * @param minTimestamp - Start timestamp
 * @param maxTimestamp - End timestamp
 * @returns Formatted date range string or "N/A"
 */
export function formatDateRange(minTimestamp: string | null, maxTimestamp: string | null): string {
  if (!minTimestamp || !maxTimestamp) return 'N/A';
  const min = new Date(minTimestamp);
  const max = new Date(maxTimestamp);
  return `${min.toLocaleString()} - ${max.toLocaleString()}`;
}

/**
 * Historical data point for speed calculations.
 */
export interface HistoricalData {
  timestamp: number;
  minBlock: string | null;
  totalBlocks: string;
  minMilestoneSeq: string | null;
  totalMilestones: string;
  priorityFeeCursor: string | null;
}

/**
 * Speed statistics for backfillers.
 */
export interface SpeedStats {
  backfillerSpeed: number | null;
  milestoneBackfillerSpeed: number | null;
  priorityFeeBackfillerSpeed: number | null;
}

/**
 * Calculate backfiller speeds from historical data.
 * @param history - Array of historical data points
 * @returns Speed statistics for block and milestone backfillers
 */
export function calculateSpeeds(history: HistoricalData[]): SpeedStats {
  if (history.length < 2) {
    return {
      backfillerSpeed: null,
      milestoneBackfillerSpeed: null,
      priorityFeeBackfillerSpeed: null,
    };
  }

  const oldest = history[0];
  const newest = history[history.length - 1];
  const timeDiffSec = (newest.timestamp - oldest.timestamp) / 1000;

  if (timeDiffSec < 1) {
    return {
      backfillerSpeed: null,
      milestoneBackfillerSpeed: null,
      priorityFeeBackfillerSpeed: null,
    };
  }

  // Backfiller speed: how fast min block is decreasing
  let backfillerSpeed: number | null = null;
  if (oldest.minBlock && newest.minBlock) {
    const oldMin = BigInt(oldest.minBlock);
    const newMin = BigInt(newest.minBlock);
    if (newMin < oldMin) {
      backfillerSpeed = Number(oldMin - newMin) / timeDiffSec;
    }
  }

  // Milestone backfiller speed: how fast min seq is decreasing
  let milestoneBackfillerSpeed: number | null = null;
  if (oldest.minMilestoneSeq && newest.minMilestoneSeq) {
    const oldMinSeq = parseInt(oldest.minMilestoneSeq, 10);
    const newMinSeq = parseInt(newest.minMilestoneSeq, 10);
    if (newMinSeq < oldMinSeq) {
      milestoneBackfillerSpeed = (oldMinSeq - newMinSeq) / timeDiffSec;
    }
  }

  // Priority fee backfiller speed: how fast cursor is decreasing (works backward)
  let priorityFeeBackfillerSpeed: number | null = null;
  if (oldest.priorityFeeCursor && newest.priorityFeeCursor) {
    const oldCursor = BigInt(oldest.priorityFeeCursor);
    const newCursor = BigInt(newest.priorityFeeCursor);
    if (newCursor < oldCursor) {
      priorityFeeBackfillerSpeed = Number(oldCursor - newCursor) / timeDiffSec;
    }
  }

  return {
    backfillerSpeed,
    milestoneBackfillerSpeed,
    priorityFeeBackfillerSpeed,
  };
}

/**
 * Format a speed value with appropriate units.
 * @param speed - Speed in items per second
 * @param unit - Unit name (e.g., "blk", "ms")
 * @param isFinished - Whether the backfill is finished
 * @param isCalculating - Whether we're still collecting data
 * @returns Formatted speed string
 */
export function formatSpeed(
  speed: number | null,
  unit: string,
  isFinished?: boolean,
  isCalculating?: boolean
): string {
  if (isFinished) return 'Finished';
  if (speed === null || speed <= 0) {
    return isCalculating ? 'Calculating...' : '-';
  }
  if (speed >= 1000) {
    return `${(speed / 1000).toFixed(1)}k ${unit}/s`;
  }
  return `${speed.toFixed(1)} ${unit}/s`;
}

/**
 * Format an ETA based on remaining items and speed.
 * @param remaining - Number of remaining items
 * @param speed - Speed in items per second
 * @returns Formatted ETA string
 */
export function formatEta(remaining: number, speed: number | null): string {
  if (speed === null || speed <= 0 || remaining <= 0) return '-';
  const seconds = remaining / speed;
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}
