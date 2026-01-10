'use client';

import { useEffect, useState } from 'react';
import { Nav } from '@/components/Nav';
import { MiniChart } from '@/components/charts/MiniChart';
import { BlockTable } from '@/components/blocks/BlockTable';

interface BlockData {
  blockNumber: string;
  timestamp: string;
  gasUsedPercent: number;
  baseFeeGwei: number;
  avgPriorityFeeGwei: number;
  medianPriorityFeeGwei: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  txCount: number;
  gasUsed: string;
  gasLimit: string;
  blockTimeSec: number | null;
  mgasPerSec: number | null;
  tps: number | null;
  finalized: boolean;
  timeToFinalitySec: number | null;
}

export default function Home() {
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBlocks = async () => {
      try {
        const response = await fetch('/api/blocks/latest');
        const data = await response.json();
        setBlocks(data.blocks || []);
      } catch (error) {
        console.error('Failed to fetch blocks:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBlocks();
    const interval = setInterval(fetchBlocks, 2000);
    return () => clearInterval(interval);
  }, []);

  const latestBlock = blocks[0];
  const lastFinalizedBlock = blocks.find(b => b.timeToFinalitySec !== null);
  const reversedBlocks = blocks.slice().reverse();
  const gasChartData = reversedBlocks.map((b, i) => ({
    time: i,
    value: b.baseFeeGwei,
    blockNumber: parseInt(b.blockNumber),
    timestamp: Math.floor(new Date(b.timestamp).getTime() / 1000),
  }));

  return (
    <div className="min-h-screen">
      <Nav />

      <main className="w-full px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MiniChart
            title="Gas Price"
            data={gasChartData}
            currentValue={latestBlock?.baseFeeGwei.toFixed(2) ?? '-'}
            unit="gwei"
            color="#2962FF"
          />
          <MiniChart
            title="Finality Time"
            data={reversedBlocks.map((b, i) => ({ time: i, value: b.timeToFinalitySec ?? 0, blockNumber: parseInt(b.blockNumber), timestamp: Math.floor(new Date(b.timestamp).getTime() / 1000) }))}
            currentValue={lastFinalizedBlock?.timeToFinalitySec?.toFixed(1) ?? '-'}
            unit="sec"
            color="#FF6D00"
          />
          <MiniChart
            title="MGAS/s"
            data={reversedBlocks.map((b, i) => ({ time: i, value: b.mgasPerSec ?? 0, blockNumber: parseInt(b.blockNumber), timestamp: Math.floor(new Date(b.timestamp).getTime() / 1000) }))}
            currentValue={latestBlock?.mgasPerSec?.toFixed(1) ?? '-'}
            unit=""
            color="#00C853"
          />
          <MiniChart
            title="TPS"
            data={reversedBlocks.map((b, i) => ({ time: i, value: b.tps ?? 0, blockNumber: parseInt(b.blockNumber), timestamp: Math.floor(new Date(b.timestamp).getTime() / 1000) }))}
            currentValue={latestBlock?.tps?.toFixed(0) ?? '-'}
            unit=""
            color="#AA00FF"
          />
        </div>

        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : (
          <BlockTable blocks={blocks} title="Latest Blocks (Live)" />
        )}
      </main>
    </div>
  );
}
