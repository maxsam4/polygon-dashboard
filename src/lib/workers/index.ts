import { LivePoller } from './livePoller';
import { MilestonePoller } from './milestonePoller';
import { Backfiller } from './backfiller';
import { MilestoneBackfiller } from './milestoneBackfiller';

let livePoller: LivePoller | null = null;
let milestonePoller: MilestonePoller | null = null;
let backfiller: Backfiller | null = null;
let milestoneBackfiller: MilestoneBackfiller | null = null;
let workersStarted = false;

export function areWorkersRunning(): boolean {
  return workersStarted;
}

export async function startWorkers(): Promise<void> {
  if (workersStarted) {
    console.log('[Workers] Workers already started, skipping...');
    return;
  }
  const targetBlock = BigInt(process.env.BACKFILL_TO_BLOCK ?? '50000000');
  const batchSize = parseInt(process.env.BACKFILL_BATCH_SIZE ?? '100', 10);
  const delayMs = parseInt(process.env.RPC_DELAY_MS ?? '100', 10);
  const targetMilestoneSeqId = parseInt(process.env.MILESTONE_BACKFILL_TARGET ?? '1', 10);

  console.log('[Workers] Starting workers...');
  console.log(`[Workers] Backfill target: ${targetBlock}`);
  console.log(`[Workers] Batch size: ${batchSize}`);
  console.log(`[Workers] RPC delay: ${delayMs}ms`);
  console.log(`[Workers] Milestone backfill target sequence ID: ${targetMilestoneSeqId}`);

  // Start workers
  livePoller = new LivePoller();
  milestonePoller = new MilestonePoller();
  backfiller = new Backfiller(targetBlock, batchSize, delayMs);
  milestoneBackfiller = new MilestoneBackfiller(targetMilestoneSeqId);

  await Promise.all([
    livePoller.start(),
    milestonePoller.start(),
    backfiller.start(),
    milestoneBackfiller.start(),
  ]);

  workersStarted = true;
  console.log('[Workers] All workers started successfully');
}

export function stopWorkers(): void {
  console.log('[Workers] Stopping workers...');
  livePoller?.stop();
  milestonePoller?.stop();
  backfiller?.stop();
  milestoneBackfiller?.stop();
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
