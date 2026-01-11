import { reconcileUnfinalizedBlocks, getUnfinalizedBlockCount } from '@/lib/queries/milestones';
import { sleep } from '@/lib/utils';

const ACTIVE_INTERVAL_MS = 500;   // 500ms when actively reconciling
const IDLE_INTERVAL_MS = 5000;    // 5 seconds when no work

export class FinalityReconciler {
  private running = false;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log('[FinalityReconciler] Starting periodic reconciliation');
    this.reconcile();
  }

  stop(): void {
    this.running = false;
  }

  private async reconcile(): Promise<void> {
    let consecutiveEmpty = 0;

    while (this.running) {
      try {
        const updated = await reconcileUnfinalizedBlocks();

        if (updated > 0) {
          consecutiveEmpty = 0;
          // Only log remaining count occasionally to reduce DB load
          if (updated >= 100) {
            const remaining = await getUnfinalizedBlockCount();
            console.log(`[FinalityReconciler] Reconciled ${updated} blocks, ${remaining} still unfinalized`);
          } else {
            console.log(`[FinalityReconciler] Reconciled ${updated} blocks`);
          }
          // More work likely available, run again quickly
          await sleep(ACTIVE_INTERVAL_MS);
        } else {
          consecutiveEmpty++;
          // No work, wait longer
          await sleep(IDLE_INTERVAL_MS);

          // Periodically log status when idle
          if (consecutiveEmpty % 12 === 0) { // Every minute when idle
            const remaining = await getUnfinalizedBlockCount();
            if (remaining > 0) {
              console.log(`[FinalityReconciler] Idle but ${remaining} blocks still unfinalized (waiting for milestones)`);
            }
          }
        }
      } catch (error) {
        console.error('[FinalityReconciler] Error:', error);
        await sleep(IDLE_INTERVAL_MS);
      }
    }
  }
}
