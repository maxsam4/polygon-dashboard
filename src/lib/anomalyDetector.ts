import { AnomalyMetricType, AnomalySeverity, ANOMALY_THRESHOLDS } from './constants';
import {
  insertAnomalyRange,
  findExtendableAnomalyRange,
  extendAnomalyRange,
  getMetricThresholds,
  MetricThreshold,
} from './queries/anomalies';

export interface BlockMetrics {
  blockNumber: bigint;
  timestamp: Date;
  baseFeeGwei: number | null;
  blockTimeSec: number | null;
  timeToFinalitySec: number | null;
  tps: number | null;
  mgasPerSec: number | null;
}

interface BlockAnomalyResult {
  blockNumber: bigint;
  timestamp: Date;
  metricType: AnomalyMetricType;
  severity: AnomalySeverity;
  value: number;
  threshold: number;
}

// Cache thresholds to avoid repeated DB queries
let cachedThresholds: Map<string, MetricThreshold> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get thresholds from DB or cache.
 */
async function getThresholds(): Promise<Map<string, MetricThreshold>> {
  const now = Date.now();
  if (!cachedThresholds || now - cacheTimestamp > CACHE_TTL_MS) {
    try {
      cachedThresholds = await getMetricThresholds();
      cacheTimestamp = now;
    } catch (error) {
      // If DB query fails, use fallback thresholds
      console.error('[AnomalyDetector] Failed to load thresholds from DB, using fallbacks:', error);
      cachedThresholds = new Map();
    }
  }
  return cachedThresholds;
}

/**
 * Get threshold for a specific metric.
 * Falls back to constants if not in DB.
 */
async function getThresholdForMetric(metricType: keyof typeof ANOMALY_THRESHOLDS): Promise<{
  warningLow: number | null;
  warningHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
}> {
  const thresholds = await getThresholds();
  const dbThreshold = thresholds.get(metricType);

  if (dbThreshold) {
    return {
      warningLow: dbThreshold.warningLow,
      warningHigh: dbThreshold.warningHigh,
      criticalLow: dbThreshold.criticalLow,
      criticalHigh: dbThreshold.criticalHigh,
    };
  }

  // Fallback to constants
  const fallback = ANOMALY_THRESHOLDS[metricType];
  return {
    warningLow: fallback.warning_low,
    warningHigh: fallback.warning_high,
    criticalLow: fallback.critical_low,
    criticalHigh: fallback.critical_high,
  };
}

/**
 * Check if a value exceeds thresholds and return the severity.
 * Returns null if value is within normal range.
 */
function checkThreshold(
  value: number,
  thresholds: {
    warningLow: number | null;
    warningHigh: number | null;
    criticalLow: number | null;
    criticalHigh: number | null;
  }
): { severity: AnomalySeverity; threshold: number; direction: 'high' | 'low' } | null {
  // Check critical thresholds first (they take precedence)
  if (thresholds.criticalHigh !== null && value >= thresholds.criticalHigh) {
    return { severity: 'critical', threshold: thresholds.criticalHigh, direction: 'high' };
  }
  if (thresholds.criticalLow !== null && value <= thresholds.criticalLow) {
    return { severity: 'critical', threshold: thresholds.criticalLow, direction: 'low' };
  }

  // Then check warning thresholds
  if (thresholds.warningHigh !== null && value >= thresholds.warningHigh) {
    return { severity: 'warning', threshold: thresholds.warningHigh, direction: 'high' };
  }
  if (thresholds.warningLow !== null && value <= thresholds.warningLow) {
    return { severity: 'warning', threshold: thresholds.warningLow, direction: 'low' };
  }

  return null;
}

/**
 * Check block metrics and return anomalies (without inserting).
 */
async function checkBlockMetrics(block: BlockMetrics): Promise<BlockAnomalyResult[]> {
  const anomalies: BlockAnomalyResult[] = [];

  // Check gas price (base fee)
  if (block.baseFeeGwei !== null) {
    const thresholds = await getThresholdForMetric('gas_price');
    const result = checkThreshold(block.baseFeeGwei, thresholds);
    if (result) {
      anomalies.push({
        blockNumber: block.blockNumber,
        timestamp: block.timestamp,
        metricType: 'gas_price',
        severity: result.severity,
        value: block.baseFeeGwei,
        threshold: result.threshold,
      });
    }
  }

  // Check block time
  if (block.blockTimeSec !== null) {
    const thresholds = await getThresholdForMetric('block_time');
    const result = checkThreshold(block.blockTimeSec, thresholds);
    if (result) {
      anomalies.push({
        blockNumber: block.blockNumber,
        timestamp: block.timestamp,
        metricType: 'block_time',
        severity: result.severity,
        value: block.blockTimeSec,
        threshold: result.threshold,
      });
    }
  }

  // Check finality time
  if (block.timeToFinalitySec !== null) {
    const thresholds = await getThresholdForMetric('finality');
    const result = checkThreshold(block.timeToFinalitySec, thresholds);
    if (result) {
      anomalies.push({
        blockNumber: block.blockNumber,
        timestamp: block.timestamp,
        metricType: 'finality',
        severity: result.severity,
        value: block.timeToFinalitySec,
        threshold: result.threshold,
      });
    }
  }

  // Check TPS
  if (block.tps !== null) {
    const thresholds = await getThresholdForMetric('tps');
    const result = checkThreshold(block.tps, thresholds);
    if (result) {
      anomalies.push({
        blockNumber: block.blockNumber,
        timestamp: block.timestamp,
        metricType: 'tps',
        severity: result.severity,
        value: block.tps,
        threshold: result.threshold,
      });
    }
  }

  // Check MGAS/s
  if (block.mgasPerSec !== null) {
    const thresholds = await getThresholdForMetric('mgas');
    const result = checkThreshold(block.mgasPerSec, thresholds);
    if (result) {
      anomalies.push({
        blockNumber: block.blockNumber,
        timestamp: block.timestamp,
        metricType: 'mgas',
        severity: result.severity,
        value: block.mgasPerSec,
        threshold: result.threshold,
      });
    }
  }

  return anomalies;
}

/**
 * Group consecutive anomalies by (metricType, severity).
 * Returns array of groups, where each group has consecutive blocks.
 */
export function groupConsecutiveAnomalies(results: BlockAnomalyResult[]): BlockAnomalyResult[][] {
  if (results.length === 0) return [];

  // Sort by metricType, severity, then blockNumber
  const sorted = [...results].sort((a, b) => {
    if (a.metricType !== b.metricType) return a.metricType.localeCompare(b.metricType);
    if (a.severity !== b.severity) return a.severity.localeCompare(b.severity);
    return a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0;
  });

  const groups: BlockAnomalyResult[][] = [];
  let currentGroup: BlockAnomalyResult[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const sameMetricAndSeverity =
      prev.metricType === curr.metricType && prev.severity === curr.severity;
    const consecutive = curr.blockNumber === prev.blockNumber + 1n;

    if (sameMetricAndSeverity && consecutive) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }

  groups.push(currentGroup);
  return groups;
}

/**
 * Process a group of consecutive anomalies.
 * Either extends an existing range or creates a new one.
 */
async function processAnomalyGroup(group: BlockAnomalyResult[]): Promise<void> {
  const first = group[0];
  const last = group[group.length - 1];

  try {
    // Check if we can extend a previous range
    const extendable = await findExtendableAnomalyRange(
      first.metricType,
      first.severity,
      first.blockNumber - 1n // Previous block
    );

    if (extendable) {
      // Extend existing range
      await extendAnomalyRange(
        extendable.id,
        extendable.timestamp,
        last.blockNumber,
        last.value
      );
      console.log(
        `[AnomalyDetector] Extended ${first.metricType} ${first.severity} range to block #${last.blockNumber}`
      );
    } else {
      // Create new range
      await insertAnomalyRange({
        timestamp: first.timestamp,
        metricType: first.metricType,
        severity: first.severity,
        value: first.value,
        threshold: first.threshold,
        startBlockNumber: first.blockNumber,
        endBlockNumber: last.blockNumber,
      });
      const rangeStr =
        first.blockNumber === last.blockNumber
          ? `block #${first.blockNumber}`
          : `blocks #${first.blockNumber}-${last.blockNumber}`;
      console.log(`[AnomalyDetector] Created ${first.metricType} ${first.severity} for ${rangeStr}`);
    }
  } catch (error) {
    console.error('[AnomalyDetector] Failed to process anomaly group:', error);
  }
}

/**
 * Check multiple blocks for anomalies and group consecutive blocks.
 * Used when processing multiple blocks at once.
 */
export async function checkBlocksForAnomalies(blocks: BlockMetrics[]): Promise<void> {
  if (blocks.length === 0) return;

  // Sort blocks by block number ascending
  const sorted = [...blocks].sort((a, b) =>
    a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0
  );

  // Check each block and collect anomaly results
  const anomalyResults: BlockAnomalyResult[] = [];
  for (const block of sorted) {
    const blockAnomalies = await checkBlockMetrics(block);
    anomalyResults.push(...blockAnomalies);
  }

  if (anomalyResults.length === 0) return;

  // Group consecutive blocks by (metricType, severity)
  const groups = groupConsecutiveAnomalies(anomalyResults);

  // Process each group (extend or create)
  for (const group of groups) {
    await processAnomalyGroup(group);
  }
}

/**
 * Record a reorg as an anomaly.
 * Reorgs are always critical and single-block events.
 */
export async function recordReorgAnomaly(
  blockNumber: bigint,
  timestamp: Date
): Promise<void> {
  try {
    await insertAnomalyRange({
      timestamp,
      metricType: 'reorg',
      severity: 'critical',
      value: null,
      threshold: null,
      startBlockNumber: blockNumber,
      endBlockNumber: blockNumber,
    });
    console.log(`[AnomalyDetector] Recorded reorg anomaly for block #${blockNumber}`);
  } catch (error) {
    console.error('[AnomalyDetector] Failed to record reorg anomaly:', error);
  }
}

/**
 * Clear the threshold cache.
 * Call this if thresholds are updated via admin interface.
 */
export function clearThresholdCache(): void {
  cachedThresholds = null;
  cacheTimestamp = 0;
}
