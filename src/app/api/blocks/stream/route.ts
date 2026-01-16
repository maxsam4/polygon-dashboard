import { getLatestBlocks } from '@/lib/queries/blocks';
import { Block, BlockDataUI } from '@/lib/types';

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
  let lastBlockNumber = 0n;
  let isConnected = true;
  // Track finality state to detect changes
  const blockFinalityState = new Map<string, boolean>();

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

      // Poll for new blocks and finality updates every 500ms
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

            if (block.blockNumber > lastBlockNumber) {
              // New block
              blocksToSend.push(block);
              blockFinalityState.set(blockNumStr, block.finalized);
            } else if (prevFinalized === false && block.finalized === true) {
              // Finality status changed from false to true
              blocksToSend.push(block);
              blockFinalityState.set(blockNumStr, true);
            }
          }

          if (blocks[0].blockNumber > lastBlockNumber) {
            lastBlockNumber = blocks[0].blockNumber;
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
      }, 500);

      // Cleanup on close
      return () => {
        isConnected = false;
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
