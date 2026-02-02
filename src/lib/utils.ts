import { GWEI_PER_POL, GAS_THRESHOLDS, TIME_SEC } from './constants';

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format a relative time string (e.g., "5s ago", "2h ago")
 */
export function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < TIME_SEC.MINUTE) return `${seconds}s ago`;
  if (seconds < TIME_SEC.HOUR) return `${Math.floor(seconds / TIME_SEC.MINUTE)}m ago`;
  if (seconds < TIME_SEC.DAY) return `${Math.floor(seconds / TIME_SEC.HOUR)}h ago`;
  return `${Math.floor(seconds / TIME_SEC.DAY)}d ago`;
}

/**
 * Format large numbers with K/M/B suffixes
 */
export function formatLargeNumber(num: number, decimals = 2): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(decimals)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(decimals)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(decimals)}K`;
  return num.toFixed(decimals);
}

/**
 * Format gas values (BigInt as string) with K/M/B suffixes
 */
export function formatGas(gas: string): string {
  const num = BigInt(gas);
  if (num >= 1_000_000_000n) {
    return `${(Number(num) / 1_000_000_000).toFixed(2)}B`;
  }
  if (num >= 1_000_000n) {
    return `${(Number(num) / 1_000_000).toFixed(2)}M`;
  }
  if (num >= 1_000n) {
    return `${(Number(num) / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}

/**
 * Convert gwei to POL with comma formatting
 * 1 POL = 1,000,000,000 gwei (10^9)
 */
export function formatGweiToPol(gwei: number | undefined | null, decimals = 4): string {
  if (gwei === undefined) return '-';
  if (gwei === null) return 'calculating';  // null = pending (receipt data not yet fetched)
  const pol = gwei / GWEI_PER_POL;
  return pol.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format POL value with commas
 */
export function formatPol(pol: number, decimals = 2): string {
  return pol.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Get the CSS color class for gas utilization percentage
 * Green: 55-75% (around 65% target)
 * Yellow: 15-55% or 75-85%
 * Red: <15% or >85%
 */
export function getGasUtilizationColor(percent: number): string {
  const { GREEN_MIN, GREEN_MAX, YELLOW_MIN, YELLOW_MAX } = GAS_THRESHOLDS;

  if (percent > YELLOW_MAX || percent < YELLOW_MIN) {
    return 'bg-danger';
  }
  if (percent > GREEN_MAX || percent < GREEN_MIN) {
    return 'bg-warning';
  }
  return 'bg-success';
}

/**
 * Calculate gas used percentage
 */
export function calculateGasPercent(gasUsed: bigint | string, gasLimit: bigint | string): number {
  const used = typeof gasUsed === 'string' ? BigInt(gasUsed) : gasUsed;
  const limit = typeof gasLimit === 'string' ? BigInt(gasLimit) : gasLimit;
  if (limit === 0n) return 0;
  return (Number(used) / Number(limit)) * 100;
}
