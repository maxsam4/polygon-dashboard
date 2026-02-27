/**
 * Client for pushing updates to the live-stream service.
 * Fire-and-forget with error handling (service may not be running).
 */

const LIVE_STREAM_URL = process.env.LIVE_STREAM_URL || 'http://live-stream:3002';

export interface BlockUpdatePayload {
  blockNumber: number;
  // Block metrics
  txCount?: number;
  // Priority fee metrics from receipts
  minPriorityFeeGwei?: number;
  maxPriorityFeeGwei?: number;
  avgPriorityFeeGwei?: number;
  medianPriorityFeeGwei?: number;
  totalPriorityFeeGwei?: number;
  // Finality data
  finalized?: boolean;
  finalizedAt?: number;
  milestoneId?: number;
  timeToFinalitySec?: number;
}

/**
 * Push a block update to the live-stream service.
 * Returns true if successful, false if the service is unavailable or an error occurred.
 */
export async function pushBlockUpdate(payload: BlockUpdatePayload): Promise<boolean> {
  try {
    const response = await fetch(`${LIVE_STREAM_URL}/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      // Service returned an error, but don't log as it's expected when service is down
      return false;
    }

    return true;
  } catch {
    // Service is unavailable - this is expected when live-stream service is not running
    return false;
  }
}

/**
 * Push multiple block updates to the live-stream service.
 * Fire-and-forget with error handling.
 */
export async function pushBlockUpdates(payloads: BlockUpdatePayload[]): Promise<void> {
  await Promise.all(payloads.map(payload => pushBlockUpdate(payload).catch(() => {})));
}
