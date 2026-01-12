'use client';

import { Nav } from '@/components/Nav';
import { FullChart } from '@/components/charts/FullChart';
import { CustomizableChart } from '@/components/charts/CustomizableChart';

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen">
      <Nav />

      <main className="w-full px-4 py-6">
        {/* Customizable charts at the top */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <CustomizableChart
            title="Compare (Dual Axis)"
            defaultLeftSeries="baseFee"
            defaultRightSeries="blockLimit"
            dualAxis={true}
          />
          <CustomizableChart
            title="Compare (Same Axis)"
            defaultLeftSeries="cumulativeBaseFee"
            defaultRightSeries="cumulativePriorityFee"
            dualAxis={false}
          />
        </div>

        {/* Block Time Charts - for detecting downtime and performance issues */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <FullChart title="Bor Block Time (seconds)" metric="borBlockTime" />
          <FullChart title="Milestone Time (seconds)" metric="heimdallBlockTime" />
        </div>

        {/* Standard charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <FullChart title="Gas Price (gwei)" metric="gas" />
          <FullChart title="Finality Time (seconds)" metric="finality" />
          <FullChart title="MGAS/s" metric="mgas" />
          <FullChart title="TPS" metric="tps" />
          <FullChart title="Block Limit (M gas)" metric="blockLimit" />
          <FullChart title="Block Utilization (%)" metric="blockLimitUtilization" />
          <FullChart title="Total Base Fee per Block (POL)" metric="totalBaseFee" />
          <FullChart title="Total Priority Fee per Block (POL)" metric="totalPriorityFee" />
          <FullChart title="Total Fee per Block (POL)" metric="totalFee" />
          <FullChart title="Cumulative Base Fee per Block (POL)" metric="totalBaseFee" showCumulative />
          <FullChart title="Cumulative Priority Fee per Block (POL)" metric="totalPriorityFee" showCumulative />
          <FullChart title="Cumulative Total Fee per Block (POL)" metric="totalFee" showCumulative />
        </div>
      </main>
    </div>
  );
}
