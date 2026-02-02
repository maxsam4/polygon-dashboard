/**
 * Date and time formatting utilities for chart components.
 * Centralized to avoid duplication across FullChart, CustomizableChart, and InflationChart.
 */

import { TIME_SEC } from './constants';

/**
 * Format a Date object for datetime-local input value.
 * @param date - Date to format
 * @returns String in YYYY-MM-DDTHH:mm format
 */
export function formatDateTimeLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Determine if dates should be shown (for ranges longer than 1 day).
 * @param range - Time range string (e.g., '1D', '1W', 'Custom')
 * @param appliedCustomRange - Optional custom range with start/end timestamps
 * @returns true if dates should be displayed
 */
export function shouldShowDates(
  range: string,
  appliedCustomRange: { start: number; end: number } | null
): boolean {
  if (range === 'Custom' && appliedCustomRange) {
    return (appliedCustomRange.end - appliedCustomRange.start) > TIME_SEC.DAY;
  }
  const longRanges = ['1D', '1W', '1M', '6M', '1Y', 'YTD', 'ALL'];
  return longRanges.includes(range);
}

/**
 * Format a Unix timestamp for chart time axis labels.
 * Shows date for long ranges, time for short ranges.
 * @param time - Unix timestamp in seconds
 * @param showDates - Whether to show date (true) or time (false)
 * @returns Formatted time label string
 */
export function formatTimeLabel(time: number, showDates: boolean): string {
  const date = new Date(time * 1000);
  if (showDates) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Format a Unix timestamp for tooltip display.
 * Shows date + time for long ranges, just time for short ranges.
 * @param timestamp - Unix timestamp in seconds
 * @param showDates - Whether to include date
 * @returns Formatted tooltip time string
 */
export function formatTooltipTime(timestamp: number, showDates: boolean): string {
  const date = new Date(timestamp * 1000);
  if (showDates) {
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Format a Unix timestamp with full date and time details.
 * Used for detailed tooltip display.
 * @param timestamp - Unix timestamp in seconds
 * @returns Full formatted datetime string
 */
export function formatFullDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString([], {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
