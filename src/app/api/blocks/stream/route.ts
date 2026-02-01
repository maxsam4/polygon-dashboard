import { getLatestBlocks } from '@/lib/queries/blocks';
import { Block, BlockDataUI } from '@/lib/types';
import { blockChannel } from '@/lib/blockChannel';

export const dynamic = 'force-dynamic';

// Check if we should use the live-stream service
const USE_LIVE_STREAM_SERVICE = process.env.USE_LIVE_STREAM_SERVICE === 'true';
const LIVE_STREAM_URL = process.env.LIVE_STREAM_URL || 'http://live-stream:3002';

// Transform Block to BlockDataUI for SSE streaming
function blockToUI(b: Block): BlockDataUI {
  const gasUsed = Number(b.gasUsed);
  const gasLimit = Number(b.gasLimit);
  return {
    blockNumber: b.blockNumber.toString(),
    timestamp: b.timestamp.toISOString(),
    gasUsedPercent: gasLimit > 0 ? (gasUsed / gasLimit) * 100 : 0,
    baseFeeGwei: b.baseFeeGwei ?? 0,
    avgPriorityFeeGwei: b.avgPriorityFeeGwei,  // null = pending (receipt data not yet fetched)
    medianPriorityFeeGwei: b.medianPriorityFeeGwei ?? 0,
    minPriorityFeeGwei: b.minPriorityFeeGwei ?? 0,
    maxPriorityFeeGwei: b.maxPriorityFeeGwei ?? 0,
    txCount: b.txCount ?? 0,
    gasUsed: b.gasUsed.toString(),
    gasLimit: b.gasLimit.toString(),
    blockTimeSec: b.blockTimeSec ?? null,
    mgasPerSec: b.mgasPerSec ?? null,
    tps: b.tps ?? null,
    totalBaseFeeGwei: b.totalBaseFeeGwei ?? 0,
    totalPriorityFeeGwei: b.totalPriorityFeeGwei,  // null = pending (receipt data not yet fetched)
    finalized: b.finalized ?? false,
    timeToFinalitySec: b.timeToFinalitySec ?? null,
  };
}

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
    totalBaseFeeGwei: b.baseFeeGwei * gasUsedNum / 1e9,
    totalPriorityFeeGwei: b.totalPriorityFeeGwei ?? null,
    finalized: b.finalized ?? false,
    timeToFinalitySec,
  };
}

// Transform block_update partial update to UI format
function liveStreamUpdateToUI(blockNumber: number, updates: LiveStreamBlockUpdate): {
  blockNumber: string;
  minPriorityFeeGwei?: number;
  maxPriorityFeeGwei?: number;
  avgPriorityFeeGwei?: number;
  medianPriorityFeeGwei?: number;
  totalPriorityFeeGwei?: number;
  finalized?: boolean;
  timeToFinalitySec?: number;
} {
  const result: {
    blockNumber: string;
    minPriorityFeeGwei?: number;
    maxPriorityFeeGwei?: number;
    avgPriorityFeeGwei?: number;
    medianPriorityFeeGwei?: number;
    totalPriorityFeeGwei?: number;
    finalized?: boolean;
    timeToFinalitySec?: number;
  } = { blockNumber: blockNumber.toString() };

  if (updates.minPriorityFeeGwei !== undefined) {
    result.minPriorityFeeGwei = updates.minPriorityFeeGwei;
  }
  if (updates.maxPriorityFeeGwei !== undefined) {
    result.maxPriorityFeeGwei = updates.maxPriorityFeeGwei;
  }
  if (updates.avgPriorityFeeGwei !== undefined) {
    result.avgPriorityFeeGwei = updates.avgPriorityFeeGwei;
  }
  if (updates.medianPriorityFeeGwei !== undefined) {
    result.medianPriorityFeeGwei = updates.medianPriorityFeeGwei;
  }
  if (updates.totalPriorityFeeGwei !== undefined) {
    result.totalPriorityFeeGwei = updates.totalPriorityFeeGwei;
  }
  if (updates.finalized !== undefined) {
    result.finalized = updates.finalized;
  }
  if (updates.timeToFinalitySec !== undefined) {
    result.timeToFinalitySec = updates.timeToFinalitySec;
  }

  return result;
}

// SSE endpoint for streaming new blocks to the frontend
export async function GET() {
  // If live-stream service is enabled, proxy to it
  if (USE_LIVE_STREAM_SERVICE) {
    return proxyToLiveStream();
  }

  // Otherwise use the existing DB-backed SSE
  return dbBackedSSE();
}

// Proxy to the live-stream service and transform the response
async function proxyToLiveStream(): Promise<Response> {
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

// Original DB-backed SSE implementation
async function dbBackedSSE(): Promise<Response> {
  const encoder = new TextEncoder();
  let isConnected = true;
  // Track finality state to detect changes
  const blockFinalityState = new Map<string, boolean>();
  // Track blocks we've sent to avoid duplicates
  let lastBlockNumber = 0n;

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial blocks
      try {
        const blocks = await getLatestBlocks(20);
        if (blocks.length > 0) {
          lastBlockNumber = blocks[0].blockNumber;
          // Track initial finality state
          blocks.forEach(b => blockFinalityState.set(b.blockNumber.toString(), b.finalized));
          const data = JSON.stringify({
            type: 'initial',
            blocks: blocks.map(blockToUI),
          });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }
      } catch (error) {
        console.error('[SSE] Error fetching initial blocks:', error);
      }

      // Subscribe to block channel for instant new block notifications
      const unsubscribe = blockChannel.subscribe((block) => {
        if (!isConnected) return;

        try {
          const blockNumStr = block.blockNumber.toString();
          // Only send if this is a new block we haven't sent yet
          // Use blockFinalityState map instead of lastBlockNumber to handle out-of-order arrivals
          if (!blockFinalityState.has(blockNumStr)) {
            blockFinalityState.set(blockNumStr, block.finalized);
            if (block.blockNumber > lastBlockNumber) {
              lastBlockNumber = block.blockNumber;
            }

            const data = JSON.stringify({
              type: 'update',
              blocks: [blockToUI(block)],
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
        } catch (error) {
          console.error('[SSE] Error sending block from channel:', error);
        }
      });

      // Poll for finality updates every 1 second (new blocks come via channel)
      const pollInterval = setInterval(async () => {
        if (!isConnected) {
          clearInterval(pollInterval);
          return;
        }

        try {
          const blocks = await getLatestBlocks(20);
          if (blocks.length === 0) return;

          const blocksToSend: Block[] = [];

          for (const block of blocks) {
            const blockNumStr = block.blockNumber.toString();
            const prevFinalized = blockFinalityState.get(blockNumStr);

            // Check for finality updates (new blocks come via channel subscription)
            if (prevFinalized === false && block.finalized === true) {
              blocksToSend.push(block);
              blockFinalityState.set(blockNumStr, true);
            }

            // Also catch any blocks that might have been missed by the channel
            if (block.blockNumber > lastBlockNumber) {
              lastBlockNumber = block.blockNumber;
              if (!blockFinalityState.has(blockNumStr)) {
                blocksToSend.push(block);
                blockFinalityState.set(blockNumStr, block.finalized);
              }
            }
          }

          // Clean up old entries from state map (keep only last 30 blocks)
          if (blockFinalityState.size > 30) {
            const sortedKeys = Array.from(blockFinalityState.keys())
              .map(k => BigInt(k))
              .sort((a, b) => Number(a - b));
            const toRemove = sortedKeys.slice(0, sortedKeys.length - 30);
            toRemove.forEach(k => blockFinalityState.delete(k.toString()));
          }

          if (blocksToSend.length > 0) {
            // Sort by block number ascending for consistent ordering
            blocksToSend.sort((a, b) => Number(a.blockNumber - b.blockNumber));
            const data = JSON.stringify({
              type: 'update',
              blocks: blocksToSend.map(blockToUI),
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
        } catch (error) {
          console.error('[SSE] Error polling blocks:', error);
        }
      }, 1000); // Poll every 1s for finality updates

      // Cleanup on close
      return () => {
        isConnected = false;
        unsubscribe();
        clearInterval(pollInterval);
      };
    },
    cancel() {
      isConnected = false;
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
