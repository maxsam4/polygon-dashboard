'use client';

import { Nav } from '@/components/Nav';
import { LazyFullChart, LazyCustomizableChart, LazyInflationChart } from '@/components/charts/LazyAnalyticsCharts';

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen">
      <Nav />

      <main className="w-full px-4 py-6">
        {/* Customizable charts at the top */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <LazyCustomizableChart
            title="Compare (Dual Axis)"
            defaultLeftSeries="baseFee"
            defaultRightSeries="blockLimit"
            dualAxis={true}
          />
          <LazyCustomizableChart
            title="Compare (Same Axis)"
            defaultLeftSeries="cumulativeBaseFee"
            defaultRightSeries="cumulativePriorityFee"
            dualAxis={false}
          />
        </div>

        {/* Row 2: Net Inflation and Bor Block Time */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <LazyInflationChart title="Net Inflation (Issuance - Burned)" metric="netInflation" />
          <LazyFullChart title="Bor Block Time (seconds)" metric="borBlockTime" />
        </div>

        {/* Row 3: POL Issuance and Gas Price */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <LazyInflationChart title="POL Issuance" metric="issuance" />
          <LazyFullChart title="Gas Price (gwei)" metric="gas" />
        </div>

        {/* Standard charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <LazyFullChart title="Finality Time (seconds)" metric="finality" />
          <LazyFullChart title="MGAS/s" metric="mgas" />
          <LazyFullChart title="TPS" metric="tps" />
          <LazyFullChart title="Block Limit (M gas)" metric="blockLimit" />
          <LazyFullChart title="Block Utilization (%)" metric="blockLimitUtilization" />
          <LazyFullChart title="Total Base Fee per Block (POL)" metric="totalBaseFee" />
          <LazyFullChart title="Total Priority Fee per Block (POL)" metric="totalPriorityFee" />
          <LazyFullChart title="Total Fee per Block (POL)" metric="totalFee" />
          <LazyFullChart title="Cumulative Base Fee per Block (POL)" metric="totalBaseFee" showCumulative />
          <LazyFullChart title="Cumulative Priority Fee per Block (POL)" metric="totalPriorityFee" showCumulative />
        </div>

        {/* Full-width cumulative total fee */}
        <div className="grid grid-cols-1 gap-6 mb-6">
          <LazyFullChart title="Cumulative Total Fee per Block (POL)" metric="totalFee" showCumulative />
        </div>
      </main>
    </div>
  );
}
