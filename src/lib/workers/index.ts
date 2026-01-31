import { LivePoller } from './livePoller';
import { MilestonePoller } from './milestonePoller';
import { Backfiller } from './backfiller';
import { MilestoneBackfiller } from './milestoneBackfiller';
import { FinalityReconciler } from './finalityReconciler';
import { GapAnalyzer } from './gapAnalyzer';
import { Gapfiller } from './gapfiller';
import { getAllWorkerStatuses } from './workerStatus';
import type { WorkerStatus } from './workerStatus';

// New indexers
import { BlockIndexer, getBlockIndexer } from '../indexers/blockIndexer';
import { MilestoneIndexer, getMilestoneIndexer } from '../indexers/milestoneIndexer';
import { BlockBackfiller, getBlockBackfiller } from '../indexers/blockBackfiller';

export { getAllWorkerStatuses };
export type { WorkerStatus };

// Feature flags for new indexers
const USE_NEW_BLOCK_INDEXER = process.env.USE_NEW_BLOCK_INDEXER === 'true';
const USE_NEW_MILESTONE_INDEXER = process.env.USE_NEW_MILESTONE_INDEXER === 'true';

// Use globalThis to share state across different module instances in Next.js bundling
const globalState = globalThis as typeof globalThis & {
  __workersStarted?: boolean;
  // Old workers
  __livePoller?: LivePoller;
  __milestonePoller?: MilestonePoller;
  __backfiller?: Backfiller;
  __milestoneBackfiller?: MilestoneBackfiller;
  __finalityReconciler?: FinalityReconciler;
  __gapAnalyzer?: GapAnalyzer;
  __gapfiller?: Gapfiller;
  // New indexers
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
  const targetBlock = BigInt(process.env.BACKFILL_TO_BLOCK ?? '50000000');
  const rpcDelayMs = parseInt(process.env.RPC_DELAY_MS ?? '100', 10);
  const heimdallDelayMs = parseInt(process.env.HEIMDALL_DELAY_MS ?? '200', 10);

  console.log('[Workers] Starting workers...');
  console.log(`[Workers] Backfill target: ${targetBlock}`);
  console.log(`[Workers] RPC delay: ${rpcDelayMs}ms, Heimdall delay: ${heimdallDelayMs}ms`);
  console.log(`[Workers] USE_NEW_BLOCK_INDEXER: ${USE_NEW_BLOCK_INDEXER}`);
  console.log(`[Workers] USE_NEW_MILESTONE_INDEXER: ${USE_NEW_MILESTONE_INDEXER}`);

  const startPromises: Promise<void>[] = [];

  // Block indexing: new or old
  if (USE_NEW_BLOCK_INDEXER) {
    console.log('[Workers] Using NEW block indexer');
    globalState.__blockIndexer = getBlockIndexer();
    globalState.__blockBackfiller = getBlockBackfiller();
    startPromises.push(globalState.__blockIndexer.start());
    startPromises.push(globalState.__blockBackfiller.start());
  } else {
    console.log('[Workers] Using OLD block workers (LivePoller, Backfiller, GapAnalyzer, Gapfiller)');
    globalState.__livePoller = new LivePoller();
    globalState.__backfiller = new Backfiller(targetBlock, rpcDelayMs);
    globalState.__gapAnalyzer = new GapAnalyzer();
    globalState.__gapfiller = new Gapfiller(rpcDelayMs);
    startPromises.push(globalState.__livePoller.start());
    startPromises.push(globalState.__backfiller.start());
    startPromises.push(globalState.__gapAnalyzer.start());
    startPromises.push(globalState.__gapfiller.start());
  }

  // Milestone indexing: new or old
  if (USE_NEW_MILESTONE_INDEXER) {
    console.log('[Workers] Using NEW milestone indexer');
    globalState.__milestoneIndexer = getMilestoneIndexer();
    startPromises.push(globalState.__milestoneIndexer.start());
  } else {
    console.log('[Workers] Using OLD milestone workers (MilestonePoller, MilestoneBackfiller, FinalityReconciler)');
    globalState.__milestonePoller = new MilestonePoller();
    globalState.__milestoneBackfiller = new MilestoneBackfiller(targetBlock, heimdallDelayMs);
    globalState.__finalityReconciler = new FinalityReconciler();
    startPromises.push(globalState.__milestonePoller.start());
    startPromises.push(globalState.__milestoneBackfiller.start());
    startPromises.push(globalState.__finalityReconciler.start());
  }

  await Promise.all(startPromises);

  globalState.__workersStarted = true;
  console.log('[Workers] All workers started successfully');
}

export function stopWorkers(): void {
  console.log('[Workers] Stopping workers...');

  // Stop old workers
  globalState.__livePoller?.stop();
  globalState.__milestonePoller?.stop();
  globalState.__backfiller?.stop();
  globalState.__milestoneBackfiller?.stop();
  globalState.__finalityReconciler?.stop();
  globalState.__gapAnalyzer?.stop();
  globalState.__gapfiller?.stop();

  // Stop new indexers
  globalState.__blockIndexer?.stop();
  globalState.__milestoneIndexer?.stop();
  globalState.__blockBackfiller?.stop();

  globalState.__workersStarted = false;
  console.log('[Workers] All workers stopped');
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
