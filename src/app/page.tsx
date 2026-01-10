'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';
import { MiniChart } from '@/components/charts/MiniChart';
import { BlockList } from '@/components/blocks/BlockList';

interface BlockData {
  blockNumber: string;
  timestamp: string;
  gasUsedPercent: number;
  baseFeeGwei: number;
  avgPriorityFeeGwei: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  txCount: number;
  gasUsed: string;
  gasLimit: string;
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
  const chartData = blocks
    .slice()
    .reverse()
    .map((b, i) => ({ time: i, value: b.baseFeeGwei }));

  return (
    <div className="min-h-screen">
      <header className="bg-white dark:bg-gray-900 shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">Polygon Dashboard</h1>
          <div className="flex items-center gap-4">
            <Link href="/analytics" className="text-blue-500 hover:underline">
              Analytics
            </Link>
            <Link href="/blocks" className="text-blue-500 hover:underline">
              Blocks
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MiniChart
            title="Gas Price"
            data={chartData}
            currentValue={latestBlock?.baseFeeGwei.toFixed(2) ?? '-'}
            unit="gwei"
            color="#2962FF"
          />
          <MiniChart
            title="Finality Delay"
            data={blocks.slice().reverse().map((b, i) => ({ time: i, value: b.timeToFinalitySec ?? 0 }))}
            currentValue={latestBlock?.timeToFinalitySec?.toFixed(1) ?? '-'}
            unit="sec"
            color="#FF6D00"
          />
          <MiniChart
            title="MGAS/s"
            data={blocks.slice().reverse().map((b, i) => ({ time: i, value: b.mgasPerSec ?? 0 }))}
            currentValue={latestBlock?.mgasPerSec?.toFixed(1) ?? '-'}
            unit=""
            color="#00C853"
          />
          <MiniChart
            title="TPS"
            data={blocks.slice().reverse().map((b, i) => ({ time: i, value: b.tps ?? 0 }))}
            currentValue={latestBlock?.tps?.toFixed(0) ?? '-'}
            unit=""
            color="#AA00FF"
          />
        </div>

        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : (
          <BlockList blocks={blocks} title="Latest Blocks (Live)" />
        )}
      </main>
    </div>
  );
}
