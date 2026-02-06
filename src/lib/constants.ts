// Unit conversions
export const GWEI_PER_POL = 1_000_000_000;
export const GWEI = 1_000_000_000n;

// UI Constants
export const UI_CONSTANTS = {
  TOOLTIP_WIDTH: 220,
  TOOLTIP_HEIGHT: 100,
  TOOLTIP_OFFSET: 15,
  RING_BUFFER_SIZE: 30,
  MAX_HISTORY_SAMPLES: 12,
} as const;

// RPC retry configuration
export const RPC_RETRY_CONFIG = {
  MAX_RETRIES: 3,
  DELAY_MS: 500,
  RECONNECT_DELAY_MS: 1000,
  RECONNECT_INTERVAL_MS: 10000,
} as const;

// Status page thresholds
export const STATUS_THRESHOLDS = {
  BLOCK_FRESHNESS_SEC: 10,
  MILESTONE_AGE_WARNING_SEC: 30,
  BLOCK_DIFF_WARNING: 100n,
} as const;

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

// Block time threshold for data quality checks.
// Polygon's target block time is 2s. Values above this threshold are likely
// stale or incorrect (e.g., from a missed previous block) and should be overwritten.
export const BLOCK_TIME_SUSPECT_THRESHOLD_SEC = 3;

// Worker polling intervals
export const WORKER_INTERVALS = {
  LIVE_POLL_MS: 2000,
  EXHAUSTED_RETRY_MS: 5 * 60 * 1000,
  RECONCILER_INTERVAL_MS: 10 * 1000,
} as const;

// Chart colors - Terminal theme
export const CHART_COLORS = {
  PRIMARY: '#00FF41',    // Matrix green
  SECONDARY: '#00D4FF',  // Cyan
  SUCCESS: '#00FF41',    // Matrix green
  TERTIARY: '#00D4FF',   // Cyan
  DANGER: '#FF3B3B',     // Red
  WARNING: '#FFB800',    // Amber
} as const;

export const CHART_COLOR_PALETTE = [
  CHART_COLORS.PRIMARY,
  CHART_COLORS.SECONDARY,
  CHART_COLORS.SUCCESS,
  CHART_COLORS.TERTIARY,
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
  'YTD': '1d',
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
  POLYGONSCAN_TX: 'https://polygonscan.com/tx/',
  POLYGONSCAN_ADDRESS: 'https://polygonscan.com/address/',
} as const;

// Ethereum mainnet RPC URLs (for POL inflation data)
// These endpoints support archive node queries for historical state
export const ETH_RPC_URLS = process.env.ETH_RPC_URLS?.split(',').map(s => s.trim()).filter(Boolean) || [
  'https://ethereum-rpc.publicnode.com', // PublicNode - claims archive support
  'https://rpc.ankr.com/eth',            // Ankr - free tier
  'https://eth.drpc.org',                 // dRPC - free tier
  'https://eth.llamarpc.com',            // LlamaRPC
  'https://ethereum.publicnode.com',     // PublicNode alt
];

// POL Emission Manager contract (Ethereum mainnet)
export const POL_EMISSION_MANAGER_PROXY = '0xbC9f74b3b14f460a6c47dCdDFd17411cBc7b6c53' as const;

// Inflation calculation constants
export const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
export const POL_DECIMALS = 18;
export const WEI_PER_POL = 10n ** 18n;

// Anomaly detection thresholds (calibrated from February 2026 statistics)
// These are fallback values; actual thresholds are stored in metric_thresholds table
export const ANOMALY_THRESHOLDS = {
  gas_price: {
    warning_low: 10,
    warning_high: 2000,
    critical_low: 2,
    critical_high: 5000,
    min_consecutive_blocks: 2, // Gas spikes often transient
  },
  block_time: {
    warning_low: null,
    warning_high: 3,
    critical_low: 1,
    critical_high: 5,
    min_consecutive_blocks: 1,
  },
  finality: {
    warning_low: null,
    warning_high: 10,
    critical_low: null,
    critical_high: 30,
    min_consecutive_blocks: 1,
  },
  tps: {
    warning_low: 5,
    warning_high: 2000,
    critical_low: null,
    critical_high: 3000,
    min_consecutive_blocks: 1,
  },
  mgas: {
    warning_low: 2,
    warning_high: null,
    critical_low: null,
    critical_high: null,
    min_consecutive_blocks: 1,
  },
} as const;

export type AnomalyMetricType = keyof typeof ANOMALY_THRESHOLDS | 'reorg';
export type AnomalySeverity = 'warning' | 'critical';

// All available time ranges for chart controls
export const ALL_TIME_RANGES = ['5m', '15m', '30m', '1H', '3H', '6H', '1D', '1W', '1M', '6M', '1Y', 'YTD', 'ALL', 'Custom'] as const;

// Bucket size configuration for charts
export const ALL_BUCKET_SIZES = ['2s', '1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const;

export const BUCKET_SIZES_SECONDS: Record<string, number> = {
  '2s': 2,
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
};

// Maximum number of data points the API will return
export const MAX_BUCKETS = 10000;

/**
 * Get available bucket sizes for a given time range.
 * Returns only bucket sizes that won't exceed MAX_BUCKETS data points.
 */
export function getAvailableBuckets(timeRangeSeconds: number): string[] {
  return ALL_BUCKET_SIZES.filter(
    (size) => Math.ceil(timeRangeSeconds / BUCKET_SIZES_SECONDS[size]) <= MAX_BUCKETS
  );
}

/**
 * Get the time range in seconds from state.
 * Handles preset ranges, custom ranges, and YTD.
 */
export function getTimeRangeSeconds(
  timeRange: string,
  appliedCustomRange: { start: number; end: number } | null
): number {
  if (timeRange === 'Custom' && appliedCustomRange) {
    return appliedCustomRange.end - appliedCustomRange.start;
  }
  if (timeRange === 'YTD') {
    const now = Date.now() / 1000;
    const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
    return now - startOfYear;
  }
  if (timeRange === 'ALL') {
    // For ALL, return a large number that will filter to weekly buckets
    return TIME_SEC.YEAR * 10;
  }
  return TIME_RANGE_SECONDS[timeRange] ?? TIME_SEC.DAY;
}
