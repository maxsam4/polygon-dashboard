import { getAllWorkerStatuses } from './workerStatus';
import type { WorkerStatus } from './workerStatus';

// Indexers
import { BlockIndexer, getBlockIndexer } from '../indexers/blockIndexer';
import { MilestoneIndexer, getMilestoneIndexer } from '../indexers/milestoneIndexer';
import { BlockBackfiller, getBlockBackfiller } from '../indexers/blockBackfiller';

export { getAllWorkerStatuses };
export type { WorkerStatus };

// Use globalThis to share state across different module instances in Next.js bundling
const globalState = globalThis as typeof globalThis & {
  __workersStarted?: boolean;
  __blockIndexer?: BlockIndexer;
  __milestoneIndexer?: MilestoneIndexer;
  __blockBackfiller?: BlockBackfiller;
};

export function areWorkersRunning(): boolean {
  return globalState.__workersStarted ?? false;
}

export async function startWorkers(): Promise<void> {
  if (globalState.__workersStarted) {
    console.log('[Workers] Workers already started, skipping...');
    return;
  }

  console.log('[Workers] Starting indexers...');

  globalState.__blockIndexer = getBlockIndexer();
  globalState.__blockBackfiller = getBlockBackfiller();
  globalState.__milestoneIndexer = getMilestoneIndexer();

  await Promise.all([
    globalState.__blockIndexer.start(),
    globalState.__blockBackfiller.start(),
    globalState.__milestoneIndexer.start(),
  ]);

  globalState.__workersStarted = true;
  console.log('[Workers] All indexers started successfully');
}

export function stopWorkers(): void {
  console.log('[Workers] Stopping indexers...');

  globalState.__blockIndexer?.stop();
  globalState.__milestoneIndexer?.stop();
  globalState.__blockBackfiller?.stop();

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
