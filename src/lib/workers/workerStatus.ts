// Worker status tracking for health monitoring
// In-memory Map is the source of truth for the indexer process.
// Periodic DB flush writes snapshots to worker_status so the Next.js app can read them.

import { query } from '../db';

export type WorkerState = 'running' | 'idle' | 'error' | 'stopped';

export interface WorkerStatus {
  name: string;
  state: WorkerState;
  lastRunAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  itemsProcessed: number;
}

// Use globalThis to share state across different module instances in Next.js bundling
const globalState = globalThis as typeof globalThis & {
  __workerStatuses?: Map<string, WorkerStatus>;
};

function getStatusMap(): Map<string, WorkerStatus> {
  if (!globalState.__workerStatuses) {
    globalState.__workerStatuses = new Map();
  }
  return globalState.__workerStatuses;
}

export function initWorkerStatus(name: string): void {
  const map = getStatusMap();
  if (!map.has(name)) {
    map.set(name, {
      name,
      state: 'stopped',
      lastRunAt: null,
      lastErrorAt: null,
      lastError: null,
      itemsProcessed: 0,
    });
  }
}

export function updateWorkerState(name: string, state: WorkerState): void {
  const map = getStatusMap();
  const status = map.get(name);
  if (status) {
    status.state = state;
    if (state === 'running') {
      status.lastRunAt = new Date();
    }
  }
}

export function updateWorkerRun(name: string, itemsProcessed: number = 0): void {
  const map = getStatusMap();
  const status = map.get(name);
  if (status) {
    status.lastRunAt = new Date();
    status.itemsProcessed += itemsProcessed;
  }
}

export function updateWorkerError(name: string, error: string): void {
  const map = getStatusMap();
  const status = map.get(name);
  if (status) {
    status.state = 'error';
    status.lastErrorAt = new Date();
    status.lastError = error;
  }
}

export function getAllWorkerStatuses(): WorkerStatus[] {
  const map = getStatusMap();
  return Array.from(map.values());
}

export function getWorkerStatus(name: string): WorkerStatus | undefined {
  return getStatusMap().get(name);
}

// --- DB flush (same pattern as rpcStats.ts) ---

const STATUS_FLUSH_INTERVAL_MS = 5000;
let statusFlushTimer: ReturnType<typeof setInterval> | null = null;

async function flushAllToDb(): Promise<void> {
  const statuses = getAllWorkerStatuses();
  if (statuses.length === 0) return;

  const values: unknown[] = [];
  const rows: string[] = [];

  for (let i = 0; i < statuses.length; i++) {
    const s = statuses[i];
    const o = i * 6;
    rows.push(`($${o+1}, $${o+2}, $${o+3}, $${o+4}, $${o+5}, $${o+6}, NOW())`);
    values.push(s.name, s.state, s.lastRunAt, s.lastErrorAt, s.lastError, s.itemsProcessed);
  }

  try {
    await query(
      `INSERT INTO worker_status (worker_name, state, last_run_at, last_error_at, last_error, items_processed, updated_at)
       VALUES ${rows.join(', ')}
       ON CONFLICT (worker_name) DO UPDATE SET
         state = EXCLUDED.state,
         last_run_at = EXCLUDED.last_run_at,
         last_error_at = EXCLUDED.last_error_at,
         last_error = EXCLUDED.last_error,
         items_processed = EXCLUDED.items_processed,
         updated_at = NOW()`,
      values,
    );
  } catch (error) {
    console.warn('[WorkerStatus] Failed to flush to DB:', error instanceof Error ? error.message : error);
  }
}

export function startStatusFlush(): void {
  if (statusFlushTimer) return;
  statusFlushTimer = setInterval(flushAllToDb, STATUS_FLUSH_INTERVAL_MS);
  // Initial flush so status appears immediately
  flushAllToDb().catch(() => {});
  console.log('[WorkerStatus] Started periodic DB flush (every 5s)');
}

export function stopStatusFlush(): void {
  if (statusFlushTimer) {
    clearInterval(statusFlushTimer);
    statusFlushTimer = null;
  }
  // Final flush
  flushAllToDb().catch(() => {});
  console.log('[WorkerStatus] Stopped periodic DB flush');
}
