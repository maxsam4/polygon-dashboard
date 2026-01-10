'use client';

import { Nav } from '@/components/Nav';
import { FullChart } from '@/components/charts/FullChart';

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen">
      <Nav />

      <main className="w-full px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <FullChart title="Gas Price (gwei)" metric="gas" />
          <FullChart title="Finality Time (seconds)" metric="finality" />
          <FullChart title="MGAS/s" metric="mgas" />
          <FullChart title="TPS" metric="tps" />
          <FullChart title="Total Base Fee (gwei)" metric="totalBaseFee" />
          <FullChart title="Total Priority Fee (gwei)" metric="totalPriorityFee" />
          <FullChart title="Cumulative Base Fee (gwei)" metric="totalBaseFee" showCumulative />
          <FullChart title="Cumulative Priority Fee (gwei)" metric="totalPriorityFee" showCumulative />
        </div>
      </main>
    </div>
  );
}
