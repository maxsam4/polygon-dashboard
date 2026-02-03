import { BlockDataUI } from '@/lib/types';

export const dynamic = 'force-dynamic';

const LIVE_STREAM_URL = process.env.LIVE_STREAM_URL || 'http://live-stream:3002';

// Transform live-stream block format to BlockDataUI
interface LiveStreamBlock {
  blockNumber: number;
  blockHash: string;
  parentHash: string;
  timestamp: number;
  gasUsed: string;
  gasLimit: string;
  baseFeeGwei: number;
  txCount: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  medianPriorityFeeGwei: number;
  blockTimeSec: number | null;
  mgasPerSec: number | null;
  tps: number | null;
  // Receipt-based metrics (null = pending)
  avgPriorityFeeGwei: number | null;
  totalPriorityFeeGwei: number | null;
  // Finality data
  finalized: boolean;
  finalizedAt: number | null;
  milestoneId: number | null;
  timeToFinalitySec: number | null;
}

// Partial block update from live-stream
interface LiveStreamBlockUpdate {
  txCount?: number;
  tps?: number;
  minPriorityFeeGwei?: number;
  maxPriorityFeeGwei?: number;
  avgPriorityFeeGwei?: number;
  medianPriorityFeeGwei?: number;
  totalPriorityFeeGwei?: number;
  finalized?: boolean;
  finalizedAt?: number;
  milestoneId?: number;
  timeToFinalitySec?: number;
}

function liveStreamBlockToUI(b: LiveStreamBlock): BlockDataUI {
  const gasUsed = BigInt(b.gasUsed);
  const gasLimit = BigInt(b.gasLimit);
  const gasUsedNum = Number(gasUsed);
  const gasLimitNum = Number(gasLimit);

  // Calculate timeToFinalitySec from finalizedAt and timestamp if available
  let timeToFinalitySec = b.timeToFinalitySec;
  if (timeToFinalitySec === null && b.finalized && b.finalizedAt !== null) {
    timeToFinalitySec = b.finalizedAt - b.timestamp;
  }

  return {
    blockNumber: b.blockNumber.toString(),
    timestamp: new Date(b.timestamp * 1000).toISOString(),
    gasUsedPercent: gasLimitNum > 0 ? (gasUsedNum / gasLimitNum) * 100 : 0,
    baseFeeGwei: b.baseFeeGwei ?? 0,
    avgPriorityFeeGwei: b.avgPriorityFeeGwei ?? null,
    medianPriorityFeeGwei: b.medianPriorityFeeGwei ?? 0,
    minPriorityFeeGwei: b.minPriorityFeeGwei ?? 0,
    maxPriorityFeeGwei: b.maxPriorityFeeGwei ?? 0,
    txCount: b.txCount ?? 0,
    gasUsed: b.gasUsed,
    gasLimit: b.gasLimit,
    blockTimeSec: b.blockTimeSec ?? null,
    mgasPerSec: b.mgasPerSec ?? null,
    tps: b.tps ?? null,
    totalBaseFeeGwei: b.baseFeeGwei * gasUsedNum,
    totalPriorityFeeGwei: b.totalPriorityFeeGwei ?? null,
    finalized: b.finalized ?? false,
    timeToFinalitySec,
  };
}

// Allowed fields for block updates - explicit whitelist to prevent schema drift
const ALLOWED_UPDATE_FIELDS = [
  'txCount', 'tps', 'minPriorityFeeGwei', 'maxPriorityFeeGwei',
  'avgPriorityFeeGwei', 'medianPriorityFeeGwei', 'totalPriorityFeeGwei',
  'finalized', 'finalizedAt', 'milestoneId', 'timeToFinalitySec'
] as const;

// Transform block_update partial update to UI format
// Only picks allowed fields to prevent unexpected data from leaking through
function liveStreamUpdateToUI(
  blockNumber: number,
  updates: LiveStreamBlockUpdate
): { blockNumber: string } & Partial<LiveStreamBlockUpdate> {
  const result: { blockNumber: string } & Partial<LiveStreamBlockUpdate> = {
    blockNumber: blockNumber.toString()
  };
  for (const key of ALLOWED_UPDATE_FIELDS) {
    if (updates[key] !== undefined) {
      (result as Record<string, unknown>)[key] = updates[key];
    }
  }
  return result;
}

// SSE endpoint for streaming new blocks to the frontend
export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Use Node.js http for proper SSE streaming support
      const http = await import('http');
      const url = new URL(`${LIVE_STREAM_URL}/stream`);

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname,
          method: 'GET',
          headers: {
            'Accept': 'text/event-stream',
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            console.error(`[SSE] Live stream service returned ${res.statusCode}`);
            controller.close();
            return;
          }

          let buffer = '';

          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            // Keep the last incomplete line in buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));

                  if (data.type === 'initial') {
                    const transformed = {
                      type: 'initial',
                      blocks: (data.blocks as LiveStreamBlock[]).map(liveStreamBlockToUI),
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(transformed)}\n\n`));
                  } else if (data.type === 'update') {
                    const transformed = {
                      type: 'update',
                      blocks: [liveStreamBlockToUI(data.block as LiveStreamBlock)],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(transformed)}\n\n`));
                  } else if (data.type === 'block_update') {
                    // Partial update message - transform and forward
                    const transformed = {
                      type: 'block_update',
                      ...liveStreamUpdateToUI(data.blockNumber, data.updates as LiveStreamBlockUpdate),
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(transformed)}\n\n`));
                  }
                } catch {
                  // Pass through unparseable lines
                  controller.enqueue(encoder.encode(`${line}\n`));
                }
              } else if (line.trim()) {
                controller.enqueue(encoder.encode(`${line}\n`));
              }
            }
          });

          res.on('end', () => {
            controller.close();
          });

          res.on('error', (error) => {
            console.error('[SSE] Error reading from live stream:', error);
            controller.close();
          });
        }
      );

      req.on('error', (error) => {
        console.error('[SSE] Failed to connect to live stream service:', error);
        controller.close();
      });

      req.end();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
