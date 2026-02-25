import { query } from '../db';
import type { WorkerState } from '../workers/workerStatus';

export interface WorkerStatusRow {
  worker_name: string;
  state: WorkerState;
  last_run_at: Date | null;
  last_error_at: Date | null;
  last_error: string | null;
  items_processed: number;
  updated_at: Date;
}

export async function getWorkerStatusesFromDb(): Promise<WorkerStatusRow[]> {
  return query<WorkerStatusRow>(
    'SELECT worker_name, state, last_run_at, last_error_at, last_error, items_processed, updated_at FROM worker_status ORDER BY worker_name'
  );
}
