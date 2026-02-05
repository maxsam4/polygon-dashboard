import { query, queryOne } from '../db';
import { AnomalyMetricType, AnomalySeverity } from '../constants';

export interface Anomaly {
  id: number;
  timestamp: Date;
  metricType: AnomalyMetricType;
  severity: AnomalySeverity;
  value: number | null;
  expectedValue: number | null;
  threshold: number | null;
  startBlockNumber: bigint | null;
  endBlockNumber: bigint | null;
  createdAt: Date;
  acknowledged: boolean;
  acknowledgedAt: Date | null;
}

export interface AnomalyRow {
  id: number;
  timestamp: Date;
  metric_type: string;
  severity: string;
  value: number | null;
  expected_value: number | null;
  threshold: number | null;
  start_block_number: string | null;
  end_block_number: string | null;
  created_at: Date;
  acknowledged: boolean;
  acknowledged_at: Date | null;
}

export interface MetricThreshold {
  metricType: string;
  warningLow: number | null;
  warningHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  useAbsolute: boolean;
  minConsecutiveBlocks: number;
}

interface MetricThresholdRow {
  metric_type: string;
  warning_low: number | null;
  warning_high: number | null;
  critical_low: number | null;
  critical_high: number | null;
  use_absolute: boolean;
  min_consecutive_blocks: number | null;
}

function rowToAnomaly(row: AnomalyRow): Anomaly {
  return {
    id: row.id,
    timestamp: row.timestamp,
    metricType: row.metric_type as AnomalyMetricType,
    severity: row.severity as AnomalySeverity,
    value: row.value,
    expectedValue: row.expected_value,
    threshold: row.threshold,
    startBlockNumber: row.start_block_number ? BigInt(row.start_block_number) : null,
    endBlockNumber: row.end_block_number ? BigInt(row.end_block_number) : null,
    createdAt: row.created_at,
    acknowledged: row.acknowledged ?? false,
    acknowledgedAt: row.acknowledged_at,
  };
}

function rowToThreshold(row: MetricThresholdRow): MetricThreshold {
  return {
    metricType: row.metric_type,
    warningLow: row.warning_low,
    warningHigh: row.warning_high,
    criticalLow: row.critical_low,
    criticalHigh: row.critical_high,
    useAbsolute: row.use_absolute,
    minConsecutiveBlocks: row.min_consecutive_blocks ?? 1,
  };
}

/**
 * Get anomalies with filtering and pagination.
 * Always filters by timestamp to avoid scanning compressed chunks.
 * Applies min_consecutive_blocks filter from thresholds (reorgs exempt).
 */
export async function getAnomalies(options: {
  from?: Date;
  to?: Date;
  metricType?: string;
  severity?: AnomalySeverity;
  acknowledged?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ anomalies: Anomaly[]; total: number }> {
  const {
    from = new Date(Date.now() - 24 * 60 * 60 * 1000), // Default: 24 hours ago
    to = new Date(),
    metricType,
    severity,
    acknowledged,
    limit = 100,
    offset = 0,
  } = options;

  // Build query with filters
  // Join with thresholds to apply min_consecutive_blocks filter
  let whereClause = 'WHERE a.timestamp >= $1 AND a.timestamp <= $2';
  const params: (Date | string | number | boolean)[] = [from, to];
  let paramIndex = 3;

  if (metricType) {
    whereClause += ` AND a.metric_type = $${paramIndex++}`;
    params.push(metricType);
  }

  if (severity) {
    whereClause += ` AND a.severity = $${paramIndex++}`;
    params.push(severity);
  }

  if (acknowledged !== undefined) {
    if (acknowledged) {
      whereClause += ` AND a.acknowledged = TRUE`;
    } else {
      whereClause += ` AND (a.acknowledged = FALSE OR a.acknowledged IS NULL)`;
    }
  }

  // Filter by min_consecutive_blocks (reorgs always shown)
  const minBlocksFilter = `
    AND (
      a.end_block_number - a.start_block_number + 1 >= COALESCE(mt.min_consecutive_blocks, 1)
      OR a.metric_type = 'reorg'
    )
  `;

  const fromClause = `
    FROM anomalies a
    LEFT JOIN metric_thresholds mt ON a.metric_type = mt.metric_type
  `;

  // Get total count
  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count ${fromClause} ${whereClause} ${minBlocksFilter}`,
    params
  );
  const total = parseInt(countResult?.count || '0', 10);

  // Get paginated results
  const dataQuery = `
    SELECT a.* ${fromClause}
    ${whereClause}
    ${minBlocksFilter}
    ORDER BY a.timestamp DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;
  params.push(limit, offset);

  const rows = await query<AnomalyRow>(dataQuery, params);
  return {
    anomalies: rows.map(rowToAnomaly),
    total,
  };
}

/**
 * Get count of anomalies within a time window.
 * Used for the nav badge - excludes acknowledged alerts by default.
 * Applies min_consecutive_blocks filter from thresholds (reorgs exempt).
 */
export async function getAnomalyCount(options: {
  from?: Date;
  to?: Date;
  severity?: AnomalySeverity;
  excludeAcknowledged?: boolean;
}): Promise<{ total: number; critical: number; warning: number }> {
  const {
    from = new Date(Date.now() - 60 * 60 * 1000), // Default: 1 hour ago
    to = new Date(),
    severity,
    excludeAcknowledged = true, // Exclude acknowledged by default for badge
  } = options;

  let whereClause = 'WHERE a.timestamp >= $1 AND a.timestamp <= $2';
  const params: (Date | string)[] = [from, to];
  let paramIndex = 3;

  if (excludeAcknowledged) {
    whereClause += ` AND (a.acknowledged = FALSE OR a.acknowledged IS NULL)`;
  }

  if (severity) {
    whereClause += ` AND a.severity = $${paramIndex++}`;
    params.push(severity);
  }

  // Filter by min_consecutive_blocks (reorgs always counted)
  const minBlocksFilter = `
    AND (
      a.end_block_number - a.start_block_number + 1 >= COALESCE(mt.min_consecutive_blocks, 1)
      OR a.metric_type = 'reorg'
    )
  `;

  const result = await query<{ severity: string; count: string }>(
    `SELECT a.severity, COUNT(*) as count
     FROM anomalies a
     LEFT JOIN metric_thresholds mt ON a.metric_type = mt.metric_type
     ${whereClause}
     ${minBlocksFilter}
     GROUP BY a.severity`,
    params
  );

  let critical = 0;
  let warning = 0;

  for (const row of result) {
    if (row.severity === 'critical') {
      critical = parseInt(row.count, 10);
    } else if (row.severity === 'warning') {
      warning = parseInt(row.count, 10);
    }
  }

  return { total: critical + warning, critical, warning };
}

/**
 * Insert a new anomaly record with block range.
 */
export async function insertAnomaly(anomaly: {
  timestamp?: Date;
  metricType: AnomalyMetricType;
  severity: AnomalySeverity;
  value?: number | null;
  expectedValue?: number | null;
  threshold?: number | null;
  startBlockNumber?: bigint | null;
  endBlockNumber?: bigint | null;
}): Promise<number> {
  const result = await queryOne<{ id: number }>(
    `INSERT INTO anomalies (timestamp, metric_type, severity, value, expected_value, threshold, start_block_number, end_block_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      anomaly.timestamp || new Date(),
      anomaly.metricType,
      anomaly.severity,
      anomaly.value ?? null,
      anomaly.expectedValue ?? null,
      anomaly.threshold ?? null,
      anomaly.startBlockNumber?.toString() ?? null,
      anomaly.endBlockNumber?.toString() ?? anomaly.startBlockNumber?.toString() ?? null,
    ]
  );
  return result?.id ?? 0;
}

/**
 * Find an anomaly range that can be extended (ends at previousBlock).
 * Used to extend existing ranges when consecutive blocks have the same anomaly.
 */
export async function findExtendableAnomalyRange(
  metricType: string,
  severity: string,
  previousBlockNumber: bigint
): Promise<{ id: number; timestamp: Date } | null> {
  const result = await queryOne<{ id: number; timestamp: Date }>(
    `SELECT id, timestamp FROM anomalies
     WHERE metric_type = $1 AND severity = $2 AND end_block_number = $3
     ORDER BY timestamp DESC LIMIT 1`,
    [metricType, severity, previousBlockNumber.toString()]
  );
  return result;
}

/**
 * Extend an existing anomaly range to include more blocks.
 * Requires timestamp for efficient TimescaleDB lookup.
 */
export async function extendAnomalyRange(
  id: number,
  timestamp: Date,
  newEndBlock: bigint,
  newValue: number | null
): Promise<void> {
  await query(
    `UPDATE anomalies
     SET end_block_number = $1, value = COALESCE($2, value)
     WHERE id = $3 AND timestamp = $4`,
    [newEndBlock.toString(), newValue, id, timestamp]
  );
}

/**
 * Insert anomaly with explicit block range.
 */
export async function insertAnomalyRange(params: {
  timestamp: Date;
  metricType: AnomalyMetricType;
  severity: AnomalySeverity;
  value: number | null;
  threshold: number | null;
  startBlockNumber: bigint;
  endBlockNumber: bigint;
}): Promise<number> {
  const result = await queryOne<{ id: number }>(
    `INSERT INTO anomalies (timestamp, metric_type, severity, value, threshold, start_block_number, end_block_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      params.timestamp,
      params.metricType,
      params.severity,
      params.value,
      params.threshold,
      params.startBlockNumber.toString(),
      params.endBlockNumber.toString(),
    ]
  );
  return result?.id ?? 0;
}

/**
 * Get all metric thresholds from the database.
 */
export async function getMetricThresholds(): Promise<Map<string, MetricThreshold>> {
  const rows = await query<MetricThresholdRow>(
    'SELECT * FROM metric_thresholds'
  );

  const thresholds = new Map<string, MetricThreshold>();
  for (const row of rows) {
    thresholds.set(row.metric_type, rowToThreshold(row));
  }
  return thresholds;
}

/**
 * Get a single metric threshold.
 */
export async function getMetricThreshold(metricType: string): Promise<MetricThreshold | null> {
  const row = await queryOne<MetricThresholdRow>(
    'SELECT * FROM metric_thresholds WHERE metric_type = $1',
    [metricType]
  );
  return row ? rowToThreshold(row) : null;
}

/**
 * Get recent anomalies for chart display.
 * Returns anomalies within the last 24 hours by default.
 */
export async function getRecentAnomaliesForChart(options: {
  from?: Date;
  to?: Date;
  metricTypes?: string[];
}): Promise<Anomaly[]> {
  const {
    from = new Date(Date.now() - 24 * 60 * 60 * 1000),
    to = new Date(),
    metricTypes,
  } = options;

  let whereClause = 'WHERE timestamp >= $1 AND timestamp <= $2';
  const params: (Date | string[])[] = [from, to];

  if (metricTypes && metricTypes.length > 0) {
    whereClause += ' AND metric_type = ANY($3::text[])';
    params.push(metricTypes);
  }

  const rows = await query<AnomalyRow>(
    `SELECT * FROM anomalies
     ${whereClause}
     ORDER BY timestamp DESC
     LIMIT 1000`,
    params
  );

  return rows.map(rowToAnomaly);
}

/**
 * Get all metric thresholds as an array (for API responses).
 */
export async function getAllMetricThresholds(): Promise<MetricThreshold[]> {
  const rows = await query<MetricThresholdRow>(
    'SELECT * FROM metric_thresholds ORDER BY metric_type'
  );
  return rows.map(rowToThreshold);
}

/**
 * Update a metric threshold.
 * Uses upsert to handle both insert and update cases.
 */
export async function updateMetricThreshold(
  metricType: string,
  threshold: {
    warningLow: number | null;
    warningHigh: number | null;
    criticalLow: number | null;
    criticalHigh: number | null;
    minConsecutiveBlocks?: number;
  }
): Promise<MetricThreshold> {
  const row = await queryOne<MetricThresholdRow>(
    `INSERT INTO metric_thresholds (metric_type, warning_low, warning_high, critical_low, critical_high, min_consecutive_blocks)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (metric_type)
     DO UPDATE SET
       warning_low = EXCLUDED.warning_low,
       warning_high = EXCLUDED.warning_high,
       critical_low = EXCLUDED.critical_low,
       critical_high = EXCLUDED.critical_high,
       min_consecutive_blocks = EXCLUDED.min_consecutive_blocks,
       updated_at = NOW()
     RETURNING *`,
    [
      metricType,
      threshold.warningLow,
      threshold.warningHigh,
      threshold.criticalLow,
      threshold.criticalHigh,
      threshold.minConsecutiveBlocks ?? 1,
    ]
  );

  if (!row) {
    throw new Error(`Failed to update threshold for ${metricType}`);
  }

  return rowToThreshold(row);
}

/**
 * Acknowledge one or more anomalies.
 * Returns the number of rows updated.
 */
export async function acknowledgeAnomalies(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;

  // Create placeholders for the IN clause
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');

  // Use CTE to count updated rows efficiently in a single query
  const result = await queryOne<{ count: string }>(
    `WITH updated AS (
       UPDATE anomalies
       SET acknowledged = TRUE, acknowledged_at = NOW()
       WHERE id IN (${placeholders}) AND (acknowledged = FALSE OR acknowledged IS NULL)
       RETURNING 1
     )
     SELECT COUNT(*) as count FROM updated`,
    ids
  );

  return parseInt(result?.count || '0', 10);
}

/**
 * Acknowledge all anomalies within a time range.
 * Returns the number of rows updated.
 */
export async function acknowledgeAllAnomalies(options: {
  from?: Date;
  to?: Date;
}): Promise<number> {
  const {
    from = new Date(Date.now() - 24 * 60 * 60 * 1000),
    to = new Date(),
  } = options;

  const result = await queryOne<{ count: string }>(
    `WITH updated AS (
       UPDATE anomalies
       SET acknowledged = TRUE, acknowledged_at = NOW()
       WHERE timestamp >= $1 AND timestamp <= $2 AND (acknowledged = FALSE OR acknowledged IS NULL)
       RETURNING 1
     )
     SELECT COUNT(*) as count FROM updated`,
    [from, to]
  );

  return parseInt(result?.count || '0', 10);
}
