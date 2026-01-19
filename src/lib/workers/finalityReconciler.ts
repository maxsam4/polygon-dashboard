import { reconcileUnfinalizedBlocks } from '@/lib/queries/milestones';
import { getPendingUnfinalizedCount } from '@/lib/queries/stats';
import { sleep } from '@/lib/utils';
import { initWorkerStatus, updateWorkerState, updateWorkerRun, updateWorkerError } from './workerStatus';

const WORKER_NAME = 'FinalityReconciler';
const ACTIVE_INTERVAL_MS = 100;   // 100ms when actively reconciling for fast catch-up
const IDLE_INTERVAL_MS = 10000;   // 10 seconds when no work
const LOG_INTERVAL = 10;          // Log progress every N batches

export class FinalityReconciler {
  private running = false;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    initWorkerStatus(WORKER_NAME);
    updateWorkerState(WORKER_NAME, 'running');

    console.log('[FinalityReconciler] Starting periodic reconciliation');
    this.reconcile();
  }

  stop(): void {
    this.running = false;
    updateWorkerState(WORKER_NAME, 'stopped');
  }

  private async reconcile(): Promise<void> {
    let consecutiveEmpty = 0;
    let batchCount = 0;
    let totalReconciled = 0;

    while (this.running) {
      try {
        updateWorkerState(WORKER_NAME, 'running');
        const updated = await reconcileUnfinalizedBlocks();

        if (updated > 0) {
          consecutiveEmpty = 0;
          batchCount++;
          totalReconciled += updated;
          updateWorkerRun(WORKER_NAME, updated);

          // Log progress periodically to reduce log spam
          if (batchCount % LOG_INTERVAL === 0) {
            const remaining = await getPendingUnfinalizedCount();
            console.log(`[FinalityReconciler] Reconciled ${totalReconciled} blocks in ${batchCount} batches, ${remaining} still unfinalized`);

            totalReconciled = 0;
            batchCount = 0;
          }

          // Continue immediately when there's work (no delay for fast catch-up)
          await sleep(ACTIVE_INTERVAL_MS);
        } else {
          // Log final progress before going idle
          if (totalReconciled > 0) {
            console.log(`[FinalityReconciler] Reconciled ${totalReconciled} blocks in ${batchCount} batches`);

            totalReconciled = 0;
            batchCount = 0;
          }

          consecutiveEmpty++;
          updateWorkerState(WORKER_NAME, 'idle');
          await sleep(IDLE_INTERVAL_MS);

          // Periodically log status when idle
          if (consecutiveEmpty % 6 === 0) { // Every minute when idle
            const remaining = await getPendingUnfinalizedCount();
            if (remaining > 0) {
              console.log(`[FinalityReconciler] Idle but ${remaining} blocks still unfinalized (waiting for milestones)`);
            }
          }
        }
      } catch (error) {
        console.error('[FinalityReconciler] Error:', error);
        updateWorkerError(WORKER_NAME, error instanceof Error ? error.message : 'Unknown error');
        await sleep(IDLE_INTERVAL_MS);
      }
    }
  }
}
