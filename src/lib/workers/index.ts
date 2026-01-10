import { LivePoller } from './livePoller';
import { MilestonePoller } from './milestonePoller';
import { Backfiller } from './backfiller';

let livePoller: LivePoller | null = null;
let milestonePoller: MilestonePoller | null = null;
let backfiller: Backfiller | null = null;

export async function startWorkers(): Promise<void> {
  const targetBlock = BigInt(process.env.BACKFILL_TO_BLOCK ?? '50000000');
  const batchSize = parseInt(process.env.BACKFILL_BATCH_SIZE ?? '100', 10);
  const delayMs = parseInt(process.env.RPC_DELAY_MS ?? '100', 10);

  console.log('[Workers] Starting workers...');
  console.log(`[Workers] Backfill target: ${targetBlock}`);
  console.log(`[Workers] Batch size: ${batchSize}`);
  console.log(`[Workers] RPC delay: ${delayMs}ms`);

  // Start workers
  livePoller = new LivePoller();
  milestonePoller = new MilestonePoller();
  backfiller = new Backfiller(targetBlock, batchSize, delayMs);

  await Promise.all([
    livePoller.start(),
    milestonePoller.start(),
    backfiller.start(),
  ]);
}

export function stopWorkers(): void {
  console.log('[Workers] Stopping workers...');
  livePoller?.stop();
  milestonePoller?.stop();
  backfiller?.stop();
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
