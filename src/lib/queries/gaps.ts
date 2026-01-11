import { query, queryOne } from '../db';

// Types
export interface Gap {
  id: number;
  gapType: 'block' | 'milestone' | 'finality';
  startValue: bigint;
  endValue: bigint;
  gapSize: number;
  source: string;
  status: 'pending' | 'filling' | 'filled';
  createdAt: Date;
  filledAt: Date | null;
}

export interface DataCoverage {
  id: string;
  lowWaterMark: bigint;
  highWaterMark: bigint;
  lastAnalyzedAt: Date | null;
  updatedAt: Date;
}

export interface GapStats {
  pendingCount: number;
  totalPendingSize: number;
  fillingCount: number;
}

// Row types (database format)
interface GapRow {
  id: number;
  gap_type: string;
  start_value: string;
  end_value: string;
  gap_size: number;
  source: string;
  status: string;
  created_at: Date;
  filled_at: Date | null;
}

interface DataCoverageRow {
  id: string;
  low_water_mark: string;
  high_water_mark: string;
  last_analyzed_at: Date | null;
  updated_at: Date;
}

// Row conversion functions
function rowToGap(row: GapRow): Gap {
  return {
    id: row.id,
    gapType: row.gap_type as Gap['gapType'],
    startValue: BigInt(row.start_value),
    endValue: BigInt(row.end_value),
    gapSize: row.gap_size,
    source: row.source,
    status: row.status as Gap['status'],
    createdAt: row.created_at,
    filledAt: row.filled_at,
  };
}

function rowToCoverage(row: DataCoverageRow): DataCoverage {
  return {
    id: row.id,
    lowWaterMark: BigInt(row.low_water_mark),
    highWaterMark: BigInt(row.high_water_mark),
    lastAnalyzedAt: row.last_analyzed_at,
    updatedAt: row.updated_at,
  };
}

// 1. Insert a gap (idempotent with ON CONFLICT DO NOTHING)
export async function insertGap(
  gapType: Gap['gapType'],
  startValue: bigint,
  endValue: bigint,
  source: string
): Promise<void> {
  await query(
    `INSERT INTO gaps (gap_type, start_value, end_value, gap_size, source)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (gap_type, start_value, end_value) DO NOTHING`,
    [
      gapType,
      startValue.toString(),
      endValue.toString(),
      Number(endValue - startValue + 1n),
      source,
    ]
  );
}

// 2. Get pending gaps ordered by end_value DESC (recent first)
export async function getPendingGaps(
  gapType: Gap['gapType'],
  limit: number
): Promise<Gap[]> {
  const rows = await query<GapRow>(
    `SELECT * FROM gaps
     WHERE gap_type = $1 AND status = 'pending'
     ORDER BY end_value DESC
     LIMIT $2`,
    [gapType, limit]
  );
  return rows.map(rowToGap);
}

// 3. Atomically claim a gap (set status='filling' WHERE status='pending')
export async function claimGap(gapId: number): Promise<boolean> {
  const result = await query<{ id: number }>(
    `UPDATE gaps
     SET status = 'filling', updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING id`,
    [gapId]
  );
  return result.length > 0;
}

// 4. Mark gap as filled
export async function markGapFilled(gapId: number): Promise<void> {
  await query(
    `UPDATE gaps
     SET status = 'filled', filled_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [gapId]
  );
}

// 5. Shrink gap range (if newStart > newEnd, mark as filled)
export async function shrinkGap(
  gapId: number,
  newStartValue: bigint,
  newEndValue: bigint
): Promise<void> {
  if (newStartValue > newEndValue) {
    await markGapFilled(gapId);
    return;
  }

  await query(
    `UPDATE gaps
     SET start_value = $1, end_value = $2, gap_size = $3, updated_at = NOW()
     WHERE id = $4`,
    [
      newStartValue.toString(),
      newEndValue.toString(),
      Number(newEndValue - newStartValue + 1n),
      gapId,
    ]
  );
}

// 6. Release gap (set status back to 'pending' for failed fills)
export async function releaseGap(gapId: number): Promise<void> {
  await query(
    `UPDATE gaps
     SET status = 'pending', updated_at = NOW()
     WHERE id = $1`,
    [gapId]
  );
}

// 7. Get data coverage record by id
export async function getDataCoverage(id: string): Promise<DataCoverage | null> {
  const row = await queryOne<DataCoverageRow>(
    `SELECT * FROM data_coverage WHERE id = $1`,
    [id]
  );
  return row ? rowToCoverage(row) : null;
}

// 8. Upsert data coverage (insert or update, using LEAST/GREATEST to expand range)
export async function upsertDataCoverage(
  id: string,
  lowWaterMark: bigint,
  highWaterMark: bigint
): Promise<void> {
  await query(
    `INSERT INTO data_coverage (id, low_water_mark, high_water_mark)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       low_water_mark = LEAST(data_coverage.low_water_mark, EXCLUDED.low_water_mark),
       high_water_mark = GREATEST(data_coverage.high_water_mark, EXCLUDED.high_water_mark),
       updated_at = NOW()`,
    [id, lowWaterMark.toString(), highWaterMark.toString()]
  );
}

// 9. Explicit update of water marks
export async function updateWaterMarks(
  id: string,
  lowWaterMark: bigint,
  highWaterMark: bigint
): Promise<void> {
  await query(
    `UPDATE data_coverage
     SET low_water_mark = $1, high_water_mark = $2, updated_at = NOW()
     WHERE id = $3`,
    [lowWaterMark.toString(), highWaterMark.toString(), id]
  );
}

// 10. Get gap statistics for status page
export async function getGapStats(gapType: Gap['gapType']): Promise<GapStats> {
  const result = await queryOne<{
    pending_count: string;
    total_pending_size: string;
    filling_count: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
       COALESCE(SUM(gap_size) FILTER (WHERE status = 'pending'), 0) as total_pending_size,
       COUNT(*) FILTER (WHERE status = 'filling') as filling_count
     FROM gaps
     WHERE gap_type = $1`,
    [gapType]
  );

  return {
    pendingCount: parseInt(result?.pending_count ?? '0', 10),
    totalPendingSize: parseInt(result?.total_pending_size ?? '0', 10),
    fillingCount: parseInt(result?.filling_count ?? '0', 10),
  };
}
