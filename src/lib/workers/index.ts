import { LivePoller } from './livePoller';
import { MilestonePoller } from './milestonePoller';
import { Backfiller } from './backfiller';
import { MilestoneBackfiller } from './milestoneBackfiller';
import { FinalityReconciler } from './finalityReconciler';
import { GapAnalyzer } from './gapAnalyzer';
import { Gapfiller } from './gapfiller';
import { PriorityFeeFixer } from './priorityFeeFixer';
import { getAllWorkerStatuses } from './workerStatus';
import type { WorkerStatus } from './workerStatus';

export { getAllWorkerStatuses };
export type { WorkerStatus };

// Use globalThis to share state across different module instances in Next.js bundling
const globalState = globalThis as typeof globalThis & {
  __workersStarted?: boolean;
  __livePoller?: LivePoller;
  __milestonePoller?: MilestonePoller;
  __backfiller?: Backfiller;
  __milestoneBackfiller?: MilestoneBackfiller;
  __finalityReconciler?: FinalityReconciler;
  __gapAnalyzer?: GapAnalyzer;
  __gapfiller?: Gapfiller;
  __priorityFeeFixer?: PriorityFeeFixer;
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

  // Start workers
  globalState.__livePoller = new LivePoller();
  globalState.__milestonePoller = new MilestonePoller();
  globalState.__backfiller = new Backfiller(targetBlock, rpcDelayMs);
  globalState.__milestoneBackfiller = new MilestoneBackfiller(targetBlock, heimdallDelayMs);
  globalState.__finalityReconciler = new FinalityReconciler();
  globalState.__gapAnalyzer = new GapAnalyzer();
  globalState.__gapfiller = new Gapfiller(rpcDelayMs);
  globalState.__priorityFeeFixer = new PriorityFeeFixer();

  await Promise.all([
    globalState.__livePoller.start(),
    globalState.__milestonePoller.start(),
    globalState.__backfiller.start(),
    globalState.__milestoneBackfiller.start(),
    globalState.__finalityReconciler.start(),
    globalState.__gapAnalyzer.start(),
    globalState.__gapfiller.start(),
    globalState.__priorityFeeFixer.start(),
  ]);

  globalState.__workersStarted = true;
  console.log('[Workers] All workers started successfully');
}

export function stopWorkers(): void {
  console.log('[Workers] Stopping workers...');
  globalState.__livePoller?.stop();
  globalState.__milestonePoller?.stop();
  globalState.__backfiller?.stop();
  globalState.__milestoneBackfiller?.stop();
  globalState.__finalityReconciler?.stop();
  globalState.__gapAnalyzer?.stop();
  globalState.__gapfiller?.stop();
  globalState.__priorityFeeFixer?.stop();
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
