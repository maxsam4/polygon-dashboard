// Initialize HTTP agent with connection pooling before any fetch calls
import '../httpAgent';

import { getAllWorkerStatuses } from './workerStatus';
import type { WorkerStatus } from './workerStatus';
import { waitForMigrations } from '../waitForMigrations';

// Indexers
import { BlockIndexer, getBlockIndexer } from '../indexers/blockIndexer';
import { MilestoneIndexer, getMilestoneIndexer } from '../indexers/milestoneIndexer';
import { BlockBackfiller, getBlockBackfiller } from '../indexers/blockBackfiller';
import { MilestoneBackfiller, getMilestoneBackfiller } from '../indexers/milestoneBackfiller';
import { HistoricalPriorityFeeBackfiller, getHistoricalPriorityFeeBackfiller } from '../indexers/priorityFeeBackfill';

export { getAllWorkerStatuses };
export type { WorkerStatus };

// Use globalThis to share state across different module instances in Next.js bundling
const globalState = globalThis as typeof globalThis & {
  __workersStarted?: boolean;
  __blockIndexer?: BlockIndexer;
  __milestoneIndexer?: MilestoneIndexer;
  __blockBackfiller?: BlockBackfiller;
  __milestoneBackfiller?: MilestoneBackfiller;
  __historicalPriorityFeeBackfiller?: HistoricalPriorityFeeBackfiller;
};

export function areWorkersRunning(): boolean {
  return globalState.__workersStarted ?? false;
}

export async function startWorkers(): Promise<void> {
  if (globalState.__workersStarted) {
    console.log('[Workers] Workers already started, skipping...');
    return;
  }

  // Wait for database migrations to complete before starting workers
  await waitForMigrations();

  console.log('[Workers] Starting indexers...');

  globalState.__blockIndexer = getBlockIndexer();
  globalState.__blockBackfiller = getBlockBackfiller();
  globalState.__milestoneIndexer = getMilestoneIndexer();
  globalState.__milestoneBackfiller = getMilestoneBackfiller();
  globalState.__historicalPriorityFeeBackfiller = getHistoricalPriorityFeeBackfiller();

  const workers = [
    { name: 'BlockIndexer', start: () => globalState.__blockIndexer!.start() },
    { name: 'BlockBackfiller', start: () => globalState.__blockBackfiller!.start() },
    { name: 'MilestoneIndexer', start: () => globalState.__milestoneIndexer!.start() },
    { name: 'MilestoneBackfiller', start: () => globalState.__milestoneBackfiller!.start() },
    { name: 'HistoricalPriorityFeeBackfiller', start: () => globalState.__historicalPriorityFeeBackfiller!.start() },
  ];

  const results = await Promise.allSettled(workers.map(w => w.start()));

  const failed = results
    .map((r, i) => ({ result: r, name: workers[i].name }))
    .filter((r): r is { result: PromiseRejectedResult; name: string } => r.result.status === 'rejected');

  if (failed.length > 0) {
    for (const { name, result } of failed) {
      console.error(`[Workers] ${name} failed to start:`, result.reason);
    }
    if (failed.length === workers.length) {
      // All workers failed - stop any that partially initialized and throw
      stopWorkers();
      throw new Error(`All ${workers.length} workers failed to start`);
    }
    console.warn(`[Workers] ${failed.length}/${workers.length} workers failed to start, continuing with remaining`);
  }

  globalState.__workersStarted = true;
  console.log(`[Workers] ${workers.length - failed.length}/${workers.length} indexers started successfully`);
}

export function stopWorkers(): void {
  console.log('[Workers] Stopping indexers...');

  globalState.__blockIndexer?.stop();
  globalState.__milestoneIndexer?.stop();
  globalState.__blockBackfiller?.stop();
  globalState.__milestoneBackfiller?.stop();
  globalState.__historicalPriorityFeeBackfiller?.stop();

  globalState.__workersStarted = false;
  console.log('[Workers] All indexers stopped');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  stopWorkers();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopWorkers();
  process.exit(0);
});
