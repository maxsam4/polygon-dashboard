import { getLatestBlocks } from '@/lib/queries/blocks';
import { Block, BlockDataUI } from '@/lib/types';
import { blockChannel } from '@/lib/blockChannel';

export const dynamic = 'force-dynamic';

// Transform Block to BlockDataUI for SSE streaming
function blockToUI(b: Block): BlockDataUI {
  const gasUsed = Number(b.gasUsed);
  const gasLimit = Number(b.gasLimit);
  return {
    blockNumber: b.blockNumber.toString(),
    timestamp: b.timestamp.toISOString(),
    gasUsedPercent: gasLimit > 0 ? (gasUsed / gasLimit) * 100 : 0,
    baseFeeGwei: b.baseFeeGwei ?? 0,
    avgPriorityFeeGwei: b.avgPriorityFeeGwei ?? 0,
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
    totalPriorityFeeGwei: b.totalPriorityFeeGwei ?? 0,
    finalized: b.finalized ?? false,
    timeToFinalitySec: b.timeToFinalitySec ?? null,
  };
}

// SSE endpoint for streaming new blocks to the frontend
export async function GET() {
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
          // Only send if this is a new block we haven't sent yet
          if (block.blockNumber > lastBlockNumber) {
            lastBlockNumber = block.blockNumber;
            blockFinalityState.set(block.blockNumber.toString(), block.finalized);

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
