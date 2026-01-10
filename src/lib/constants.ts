// Unit conversions
export const GWEI_PER_POL = 1_000_000_000;
export const GWEI = 1_000_000_000n;

// Gas utilization thresholds (target is 65%)
export const GAS_THRESHOLDS = {
  TARGET: 65,
  GREEN_MIN: 55,
  GREEN_MAX: 75,
  YELLOW_MIN: 15,
  YELLOW_MAX: 85,
} as const;

// Time intervals in milliseconds
export const TIME_MS = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
} as const;

// Time intervals in seconds
export const TIME_SEC = {
  MINUTE: 60,
  HOUR: 3600,
  DAY: 86400,
  WEEK: 7 * 86400,
  MONTH: 30 * 86400,
  YEAR: 365 * 86400,
} as const;

// Worker polling intervals
export const WORKER_INTERVALS = {
  LIVE_POLL_MS: 2000,
  EXHAUSTED_RETRY_MS: 5 * 60 * 1000,
  RECONCILER_INTERVAL_MS: 10 * 1000,
} as const;

// Chart colors
export const CHART_COLORS = {
  PRIMARY: '#2962FF',
  SECONDARY: '#FF6D00',
  SUCCESS: '#00C853',
  PURPLE: '#AA00FF',
  DANGER: '#FF1744',
} as const;

export const CHART_COLOR_PALETTE = [
  CHART_COLORS.PRIMARY,
  CHART_COLORS.SECONDARY,
  CHART_COLORS.SUCCESS,
  CHART_COLORS.PURPLE,
  CHART_COLORS.DANGER,
] as const;

// Time range to bucket size mapping
export const TIME_RANGE_BUCKETS: Record<string, string> = {
  '5m': '2s',
  '15m': '2s',
  '30m': '1m',
  '1H': '1m',
  '3H': '1m',
  '6H': '5m',
  '1D': '15m',
  '1W': '1h',
  '1M': '4h',
  '6M': '1d',
  '1Y': '1d',
  'ALL': '1w',
} as const;

// Time range to seconds mapping
export const TIME_RANGE_SECONDS: Record<string, number> = {
  '5m': 5 * 60,
  '15m': 15 * 60,
  '30m': 30 * 60,
  '1H': TIME_SEC.HOUR,
  '3H': 3 * TIME_SEC.HOUR,
  '6H': 6 * TIME_SEC.HOUR,
  '1D': TIME_SEC.DAY,
  '1W': TIME_SEC.WEEK,
  '1M': TIME_SEC.MONTH,
  '6M': 6 * TIME_SEC.MONTH,
  '1Y': TIME_SEC.YEAR,
} as const;

// External URLs
export const EXTERNAL_URLS = {
  POLYGONSCAN_BLOCK: 'https://polygonscan.com/block/',
} as const;
