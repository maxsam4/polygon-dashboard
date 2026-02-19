import { query } from './db';
import type { RpcStatRecord } from './rpc';

const FLUSH_INTERVAL_MS = 5000;

let buffer: RpcStatRecord[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

export function recordRpcCall(stat: RpcStatRecord): void {
  buffer.push(stat);
}

export function sanitizeEndpoint(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export async function flushBuffer(): Promise<void> {
  // Atomically swap buffer
  const batch = buffer;
  buffer = [];

  if (batch.length === 0) return;

  // Build batch INSERT with parameterized values
  const values: unknown[] = [];
  const rows: string[] = [];

  for (let i = 0; i < batch.length; i++) {
    const stat = batch[i];
    const offset = i * 7;
    rows.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`);
    values.push(
      stat.timestamp,
      stat.endpoint,
      stat.method,
      stat.success,
      stat.isTimeout,
      Math.round(stat.responseTimeMs),
      stat.errorMessage ?? null,
    );
  }

  try {
    await query(
      `INSERT INTO rpc_call_stats (timestamp, endpoint, method, success, is_timeout, response_time_ms, error_message)
       VALUES ${rows.join(', ')}`,
      values,
    );
  } catch (error) {
    // Log but don't crash — stats are best-effort
    console.warn(`[RpcStats] Failed to flush ${batch.length} records:`, error instanceof Error ? error.message : error);
  }
}

export function startStatsFlush(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS);
  console.log('[RpcStats] Started periodic flush (every 5s)');
}

export function stopStatsFlush(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  // Flush remaining records
  flushBuffer().catch(() => {});
  console.log('[RpcStats] Stopped periodic flush');
}

// For testing
export function getBufferLength(): number {
  return buffer.length;
}

export function clearBuffer(): void {
  buffer = [];
}
