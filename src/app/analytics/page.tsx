'use client';

import { Nav } from '@/components/Nav';
import { LazySharedFullChart, LazySharedCustomizableChart, LazyInflationChart } from '@/components/charts/LazyAnalyticsCharts';
import { ChartDataProvider } from '@/contexts/ChartDataContext';

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen">
      <Nav />

      <main className="w-full px-4 py-6">
        <ChartDataProvider>
          {/* Customizable charts at the top */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <LazySharedCustomizableChart
              title="Compare (Dual Axis)"
              defaultLeftSeries="baseFee"
              defaultRightSeries="blockLimit"
              dualAxis={true}
            />
            <LazySharedCustomizableChart
              title="Compare (Same Axis)"
              defaultLeftSeries="cumulativeBaseFee"
              defaultRightSeries="cumulativePriorityFee"
              dualAxis={false}
            />
          </div>

          {/* Row 2: Net Inflation and Milestone Time */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <LazyInflationChart title="Net Inflation (Issuance - Burned)" metric="netInflation" />
            <LazySharedFullChart title="Milestone Time (seconds)" metric="heimdallBlockTime" />
          </div>

          {/* Row 3: POL Issuance and Bor Block Time */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <LazyInflationChart title="POL Issuance" metric="issuance" />
            <LazySharedFullChart title="Bor Block Time (seconds)" metric="borBlockTime" />
          </div>

          {/* Standard charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <LazySharedFullChart title="Gas Price (gwei)" metric="gas" />
            <LazySharedFullChart title="Finality Time (seconds)" metric="finality" />
            <LazySharedFullChart title="MGAS/s" metric="mgas" />
            <LazySharedFullChart title="TPS" metric="tps" />
            <LazySharedFullChart title="Block Limit (M gas)" metric="blockLimit" />
            <LazySharedFullChart title="Block Utilization (%)" metric="blockLimitUtilization" />
            <LazySharedFullChart title="Total Base Fee per Block (POL)" metric="totalBaseFee" />
            <LazySharedFullChart title="Total Priority Fee per Block (POL)" metric="totalPriorityFee" />
            <LazySharedFullChart title="Total Fee per Block (POL)" metric="totalFee" />
            <LazySharedFullChart title="Cumulative Base Fee per Block (POL)" metric="totalBaseFee" showCumulative />
            <LazySharedFullChart title="Cumulative Priority Fee per Block (POL)" metric="totalPriorityFee" showCumulative />
            <LazySharedFullChart title="Cumulative Total Fee per Block (POL)" metric="totalFee" showCumulative />
          </div>

          {/* Total Supply Chart */}
          <div className="mb-6">
            <LazyInflationChart title="Total POL Supply" metric="totalSupply" />
          </div>
        </ChartDataProvider>
      </main>
    </div>
  );
}
