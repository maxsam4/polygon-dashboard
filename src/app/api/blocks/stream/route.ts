import { getLatestBlocks } from '@/lib/queries/blocks';

export const dynamic = 'force-dynamic';

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
            blocks: blocks.map(b => ({
              blockNumber: b.blockNumber.toString(),
              timestamp: b.timestamp.toISOString(),
              baseFeeGwei: b.baseFeeGwei ?? 0,
              gasUsed: b.gasUsed.toString(),
              gasLimit: b.gasLimit.toString(),
              txCount: b.txCount ?? 0,
              blockTimeSec: b.blockTimeSec ?? null,
              mgasPerSec: b.mgasPerSec ?? 0,
              tps: b.tps ?? 0,
              finalized: b.finalized ?? false,
              timeToFinalitySec: b.timeToFinalitySec ?? null,
            })),
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
                blocks: newBlocks.map(b => ({
                  blockNumber: b.blockNumber.toString(),
                  timestamp: b.timestamp.toISOString(),
                  baseFeeGwei: b.baseFeeGwei ?? 0,
                  gasUsed: b.gasUsed.toString(),
                  gasLimit: b.gasLimit.toString(),
                  txCount: b.txCount ?? 0,
                  blockTimeSec: b.blockTimeSec ?? null,
                  mgasPerSec: b.mgasPerSec ?? 0,
                  tps: b.tps ?? 0,
                  finalized: b.finalized ?? false,
                  timeToFinalitySec: b.timeToFinalitySec ?? null,
                })),
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
