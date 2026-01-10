'use client';

import { Nav } from '@/components/Nav';
import { FullChart } from '@/components/charts/FullChart';

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen">
      <Nav />

      <main className="w-full px-4 py-6 space-y-6">
        <FullChart title="Gas Price (gwei)" metric="gas" />
        <FullChart title="Finality Delay (seconds)" metric="finality" />
        <FullChart title="MGAS/s" metric="mgas" />
        <FullChart title="TPS" metric="tps" />
      </main>
    </div>
  );
}
