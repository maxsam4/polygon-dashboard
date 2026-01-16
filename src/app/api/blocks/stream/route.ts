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

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial blocks
      try {
        const blocks = await getLatestBlocks(20);
        if (blocks.length > 0) {
          lastBlockNumber = blocks[0].blockNumber;
          const data = JSON.stringify({
            type: 'initial',
            blocks: blocks.map(blockToUI),
          });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }
      } catch (error) {
        console.error('[SSE] Error fetching initial blocks:', error);
      }

      // Poll for new blocks every 500ms and push updates
      const pollInterval = setInterval(async () => {
        if (!isConnected) {
          clearInterval(pollInterval);
          return;
        }

        try {
          const blocks = await getLatestBlocks(20);
          if (blocks.length > 0 && blocks[0].blockNumber > lastBlockNumber) {
            // Find new blocks
            const newBlocks = blocks.filter(b => b.blockNumber > lastBlockNumber);
            lastBlockNumber = blocks[0].blockNumber;

            if (newBlocks.length > 0) {
              const data = JSON.stringify({
                type: 'update',
                blocks: newBlocks.map(blockToUI),
              });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
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
