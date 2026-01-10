'use client';

import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';
import { FullChart } from '@/components/charts/FullChart';

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen">
      <header className="bg-white dark:bg-gray-900 shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-blue-500 hover:underline">
              Home
            </Link>
            <h1 className="text-xl font-bold">Historic Analytics</h1>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <FullChart title="Gas Price" metric="gas" />
        <FullChart title="Finality Delay" metric="finality" />
        <FullChart title="MGAS/s" metric="mgas" />
        <FullChart title="TPS" metric="tps" />

        <div className="flex justify-center gap-4">
          <Link href="/blocks" className="text-blue-500 hover:underline">
            View Block Details
          </Link>
        </div>
      </main>
    </div>
  );
}
