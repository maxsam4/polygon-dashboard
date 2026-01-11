// Worker status tracking for health monitoring

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
