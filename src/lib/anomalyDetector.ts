import { AnomalyMetricType, AnomalySeverity, ANOMALY_THRESHOLDS } from './constants';
import { insertAnomaly, getMetricThresholds, MetricThreshold } from './queries/anomalies';

interface BlockMetrics {
  blockNumber: bigint;
  timestamp: Date;
  baseFeeGwei: number | null;
  blockTimeSec: number | null;
  timeToFinalitySec: number | null;
  tps: number | null;
  mgasPerSec: number | null;
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
  if (thresholds.criticalHigh !== null && value > thresholds.criticalHigh) {
    return { severity: 'critical', threshold: thresholds.criticalHigh, direction: 'high' };
  }
  if (thresholds.criticalLow !== null && value < thresholds.criticalLow) {
    return { severity: 'critical', threshold: thresholds.criticalLow, direction: 'low' };
  }

  // Then check warning thresholds
  if (thresholds.warningHigh !== null && value > thresholds.warningHigh) {
    return { severity: 'warning', threshold: thresholds.warningHigh, direction: 'high' };
  }
  if (thresholds.warningLow !== null && value < thresholds.warningLow) {
    return { severity: 'warning', threshold: thresholds.warningLow, direction: 'low' };
  }

  return null;
}

/**
 * Check block metrics for anomalies and insert any detected anomalies.
 * This function is called by the BlockIndexer after processing each block.
 * It runs asynchronously and doesn't block the indexer.
 */
export async function checkBlockForAnomalies(block: BlockMetrics): Promise<void> {
  const anomaliesToInsert: Array<{
    timestamp: Date;
    metricType: AnomalyMetricType;
    severity: AnomalySeverity;
    value: number;
    threshold: number;
    blockNumber: bigint;
  }> = [];

  // Check gas price (base fee)
  if (block.baseFeeGwei !== null) {
    const thresholds = await getThresholdForMetric('gas_price');
    const result = checkThreshold(block.baseFeeGwei, thresholds);
    if (result) {
      anomaliesToInsert.push({
        timestamp: block.timestamp,
        metricType: 'gas_price',
        severity: result.severity,
        value: block.baseFeeGwei,
        threshold: result.threshold,
        blockNumber: block.blockNumber,
      });
    }
  }

  // Check block time
  if (block.blockTimeSec !== null) {
    const thresholds = await getThresholdForMetric('block_time');
    const result = checkThreshold(block.blockTimeSec, thresholds);
    if (result) {
      anomaliesToInsert.push({
        timestamp: block.timestamp,
        metricType: 'block_time',
        severity: result.severity,
        value: block.blockTimeSec,
        threshold: result.threshold,
        blockNumber: block.blockNumber,
      });
    }
  }

  // Check finality time
  if (block.timeToFinalitySec !== null) {
    const thresholds = await getThresholdForMetric('finality');
    const result = checkThreshold(block.timeToFinalitySec, thresholds);
    if (result) {
      anomaliesToInsert.push({
        timestamp: block.timestamp,
        metricType: 'finality',
        severity: result.severity,
        value: block.timeToFinalitySec,
        threshold: result.threshold,
        blockNumber: block.blockNumber,
      });
    }
  }

  // Check TPS
  if (block.tps !== null) {
    const thresholds = await getThresholdForMetric('tps');
    const result = checkThreshold(block.tps, thresholds);
    if (result) {
      anomaliesToInsert.push({
        timestamp: block.timestamp,
        metricType: 'tps',
        severity: result.severity,
        value: block.tps,
        threshold: result.threshold,
        blockNumber: block.blockNumber,
      });
    }
  }

  // Check MGAS/s
  if (block.mgasPerSec !== null) {
    const thresholds = await getThresholdForMetric('mgas');
    const result = checkThreshold(block.mgasPerSec, thresholds);
    if (result) {
      anomaliesToInsert.push({
        timestamp: block.timestamp,
        metricType: 'mgas',
        severity: result.severity,
        value: block.mgasPerSec,
        threshold: result.threshold,
        blockNumber: block.blockNumber,
      });
    }
  }

  // Insert all detected anomalies
  for (const anomaly of anomaliesToInsert) {
    try {
      await insertAnomaly(anomaly);
    } catch (error) {
      console.error('[AnomalyDetector] Failed to insert anomaly:', error);
    }
  }

  if (anomaliesToInsert.length > 0) {
    console.log(`[AnomalyDetector] Detected ${anomaliesToInsert.length} anomalies for block #${block.blockNumber}`);
  }
}

/**
 * Check multiple blocks for anomalies in batch.
 * Used when processing multiple blocks at once.
 */
export async function checkBlocksForAnomalies(blocks: BlockMetrics[]): Promise<void> {
  // Process blocks in parallel but with a limit to avoid overwhelming the DB
  const batchSize = 10;
  for (let i = 0; i < blocks.length; i += batchSize) {
    const batch = blocks.slice(i, i + batchSize);
    await Promise.all(batch.map(block => checkBlockForAnomalies(block)));
  }
}

/**
 * Record a reorg as an anomaly.
 * Reorgs are always critical.
 */
export async function recordReorgAnomaly(
  blockNumber: bigint,
  timestamp: Date
): Promise<void> {
  try {
    await insertAnomaly({
      timestamp,
      metricType: 'reorg',
      severity: 'critical',
      value: null,
      threshold: null,
      blockNumber,
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
