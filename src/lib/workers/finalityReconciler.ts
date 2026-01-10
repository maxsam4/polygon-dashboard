import { reconcileUnfinalizedBlocks, getUnfinalizedBlockCount } from '@/lib/queries/milestones';

const RECONCILE_INTERVAL_MS = 10000; // 10 seconds

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
    while (this.running) {
      try {
        const updated = await reconcileUnfinalizedBlocks();
        if (updated > 0) {
          const remaining = await getUnfinalizedBlockCount();
          console.log(`[FinalityReconciler] Reconciled ${updated} blocks, ${remaining} still unfinalized`);
        }
      } catch (error) {
        console.error('[FinalityReconciler] Error:', error);
      }
      await this.sleep(RECONCILE_INTERVAL_MS);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
