import { query } from '../db';

export interface EndpointStat {
  endpoint: string;
  total_calls: number;
  success_count: number;
  timeout_count: number;
  error_count: number;
  success_rate: number;
  avg_response_ms: number;
  p50_response_ms: number;
  p95_response_ms: number;
  p99_response_ms: number;
}

export interface MethodStat {
  method: string;
  total_calls: number;
  success_count: number;
  timeout_count: number;
  error_count: number;
  success_rate: number;
  avg_response_ms: number;
  p95_response_ms: number;
}

export interface RpcTimeSeriesPoint {
  bucket: string;
  endpoint: string;
  call_count: number;
  success_rate: number;
  avg_response_ms: number;
  p95_response_ms: number;
}

interface EndpointStatRow {
  endpoint: string;
  total_calls: string;
  success_count: string;
  timeout_count: string;
  error_count: string;
  success_rate: number;
  avg_response_ms: number;
  p50_response_ms: number;
  p95_response_ms: number;
  p99_response_ms: number;
}

interface MethodStatRow {
  method: string;
  total_calls: string;
  success_count: string;
  timeout_count: string;
  error_count: string;
  success_rate: number;
  avg_response_ms: number;
  p95_response_ms: number;
}

interface TimeSeriesRow {
  bucket: Date;
  endpoint: string;
  call_count: string;
  success_rate: number;
  avg_response_ms: number;
  p95_response_ms: number;
}

export async function getEndpointStats(from: Date, to: Date): Promise<EndpointStat[]> {
  const rows = await query<EndpointStatRow>(
    `SELECT
      endpoint,
      COUNT(*)::text AS total_calls,
      COUNT(*) FILTER (WHERE success)::text AS success_count,
      COUNT(*) FILTER (WHERE is_timeout)::text AS timeout_count,
      COUNT(*) FILTER (WHERE NOT success AND NOT is_timeout)::text AS error_count,
      ROUND(100.0 * COUNT(*) FILTER (WHERE success) / NULLIF(COUNT(*), 0), 2) AS success_rate,
      ROUND(AVG(response_time_ms)::numeric, 1) AS avg_response_ms,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY response_time_ms)::numeric, 1) AS p50_response_ms,
      ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms)::numeric, 1) AS p95_response_ms,
      ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY response_time_ms)::numeric, 1) AS p99_response_ms
    FROM rpc_call_stats
    WHERE timestamp >= $1 AND timestamp <= $2
    GROUP BY endpoint
    ORDER BY total_calls DESC`,
    [from, to],
  );

  return rows.map((r) => ({
    endpoint: r.endpoint,
    total_calls: Number(r.total_calls),
    success_count: Number(r.success_count),
    timeout_count: Number(r.timeout_count),
    error_count: Number(r.error_count),
    success_rate: Number(r.success_rate),
    avg_response_ms: Number(r.avg_response_ms),
    p50_response_ms: Number(r.p50_response_ms),
    p95_response_ms: Number(r.p95_response_ms),
    p99_response_ms: Number(r.p99_response_ms),
  }));
}

export async function getMethodStats(from: Date, to: Date): Promise<MethodStat[]> {
  const rows = await query<MethodStatRow>(
    `SELECT
      method,
      COUNT(*)::text AS total_calls,
      COUNT(*) FILTER (WHERE success)::text AS success_count,
      COUNT(*) FILTER (WHERE is_timeout)::text AS timeout_count,
      COUNT(*) FILTER (WHERE NOT success AND NOT is_timeout)::text AS error_count,
      ROUND(100.0 * COUNT(*) FILTER (WHERE success) / NULLIF(COUNT(*), 0), 2) AS success_rate,
      ROUND(AVG(response_time_ms)::numeric, 1) AS avg_response_ms,
      ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms)::numeric, 1) AS p95_response_ms
    FROM rpc_call_stats
    WHERE timestamp >= $1 AND timestamp <= $2
    GROUP BY method
    ORDER BY total_calls DESC`,
    [from, to],
  );

  return rows.map((r) => ({
    method: r.method,
    total_calls: Number(r.total_calls),
    success_count: Number(r.success_count),
    timeout_count: Number(r.timeout_count),
    error_count: Number(r.error_count),
    success_rate: Number(r.success_rate),
    avg_response_ms: Number(r.avg_response_ms),
    p95_response_ms: Number(r.p95_response_ms),
  }));
}

const BUCKET_INTERVALS: Record<string, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
};

export async function getRpcTimeSeries(from: Date, to: Date, bucket: string): Promise<RpcTimeSeriesPoint[]> {
  const interval = BUCKET_INTERVALS[bucket] ?? '5 minutes';

  const rows = await query<TimeSeriesRow>(
    `SELECT
      time_bucket($3::interval, timestamp) AS bucket,
      endpoint,
      COUNT(*)::text AS call_count,
      ROUND(100.0 * COUNT(*) FILTER (WHERE success) / NULLIF(COUNT(*), 0), 2) AS success_rate,
      ROUND(AVG(response_time_ms)::numeric, 1) AS avg_response_ms,
      ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms)::numeric, 1) AS p95_response_ms
    FROM rpc_call_stats
    WHERE timestamp >= $1 AND timestamp <= $2
    GROUP BY bucket, endpoint
    ORDER BY bucket ASC, endpoint`,
    [from, to, interval],
  );

  return rows.map((r) => ({
    bucket: r.bucket.toISOString(),
    endpoint: r.endpoint,
    call_count: Number(r.call_count),
    success_rate: Number(r.success_rate),
    avg_response_ms: Number(r.avg_response_ms),
    p95_response_ms: Number(r.p95_response_ms),
  }));
}
