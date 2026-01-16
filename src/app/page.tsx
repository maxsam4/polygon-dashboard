'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { Nav } from '@/components/Nav';
import { MiniChart } from '@/components/charts/MiniChart';
import { BlockTable } from '@/components/blocks/BlockTable';
import { BlockDataUI } from '@/lib/types';

export default function Home() {
  const [blocks, setBlocks] = useState<BlockDataUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Use Server-Sent Events for real-time updates
    const connectSSE = () => {
      const eventSource = new EventSource('/api/blocks/stream');
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'initial') {
            // Initial load - replace all blocks
            setBlocks(data.blocks);
            setLoading(false);
            setIsStreaming(true);
          } else if (data.type === 'update') {
            // Update can contain new blocks OR finality updates for existing blocks
            setBlocks(prev => {
              const updatedBlocks = [...prev];
              const existingBlockNums = new Set(prev.map(b => b.blockNumber));

              for (const block of data.blocks) {
                if (existingBlockNums.has(block.blockNumber)) {
                  // Update existing block (finality update)
                  const idx = updatedBlocks.findIndex(b => b.blockNumber === block.blockNumber);
                  if (idx !== -1) {
                    updatedBlocks[idx] = block;
                  }
                } else {
                  // New block - prepend
                  updatedBlocks.unshift(block);
                }
              }

              // Sort by block number descending and keep max 20
              updatedBlocks.sort((a, b) => parseInt(b.blockNumber) - parseInt(a.blockNumber));
              return updatedBlocks.slice(0, 20);
            });
          }
        } catch (error) {
          console.error('Failed to parse SSE data:', error);
        }
      };

      eventSource.onerror = () => {
        console.warn('SSE connection error, reconnecting...');
        setIsStreaming(false);
        eventSource.close();
        // Reconnect after 2 seconds
        setTimeout(connectSSE, 2000);
      };
    };

    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const latestBlock = blocks[0];
  const lastFinalizedBlock = blocks.find(b => b.timeToFinalitySec !== null);

  // Memoize chart data to avoid recalculating on every render
  const chartData = useMemo(() => {
    const reversed = blocks.slice().reverse();
    return {
      gas: reversed.map((b, i) => ({
        time: i,
        value: b.baseFeeGwei ?? 0,
        blockNumber: parseInt(b.blockNumber, 10),
        timestamp: Math.floor(new Date(b.timestamp).getTime() / 1000),
      })),
      finality: reversed.map((b, i) => ({
        time: i,
        value: b.timeToFinalitySec ?? 0,
        blockNumber: parseInt(b.blockNumber, 10),
        timestamp: Math.floor(new Date(b.timestamp).getTime() / 1000),
      })),
      mgas: reversed.map((b, i) => ({
        time: i,
        value: b.mgasPerSec ?? 0,
        blockNumber: parseInt(b.blockNumber, 10),
        timestamp: Math.floor(new Date(b.timestamp).getTime() / 1000),
      })),
      tps: reversed.map((b, i) => ({
        time: i,
        value: b.tps ?? 0,
        blockNumber: parseInt(b.blockNumber, 10),
        timestamp: Math.floor(new Date(b.timestamp).getTime() / 1000),
      })),
    };
  }, [blocks]);

  return (
    <div className="min-h-screen">
      <Nav />

      <main className="w-full px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MiniChart
            title="Gas Price"
            data={chartData.gas}
            currentValue={latestBlock?.baseFeeGwei?.toFixed(2) ?? '-'}
            unit="gwei"
            color="#2962FF"
          />
          <MiniChart
            title="Finality Time"
            data={chartData.finality}
            currentValue={lastFinalizedBlock?.timeToFinalitySec?.toFixed(1) ?? '-'}
            unit="sec"
            color="#FF6D00"
          />
          <MiniChart
            title="MGAS/s"
            data={chartData.mgas}
            currentValue={latestBlock?.mgasPerSec?.toFixed(1) ?? '-'}
            unit=""
            color="#00C853"
          />
          <MiniChart
            title="TPS"
            data={chartData.tps}
            currentValue={latestBlock?.tps?.toFixed(0) ?? '-'}
            unit=""
            color="#AA00FF"
          />
        </div>

        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : (
          <BlockTable
            blocks={blocks}
            title={`Latest Blocks ${isStreaming ? '(Live)' : '(Reconnecting...)'}`}
          />
        )}
      </main>
    </div>
  );
}
