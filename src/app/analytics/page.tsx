'use client';

import { Nav } from '@/components/Nav';
import { SharedFullChart } from '@/components/charts/SharedFullChart';
import { SharedCustomizableChart } from '@/components/charts/SharedCustomizableChart';
import { InflationChart } from '@/components/charts/InflationChart';
import { GlobalChartControls } from '@/components/charts/GlobalChartControls';
import { ChartDataProvider } from '@/contexts/ChartDataContext';

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen">
      <Nav />

      <main className="w-full px-4 py-6">
        <ChartDataProvider>
          {/* Global chart controls */}
          <GlobalChartControls />

          {/* Customizable charts at the top */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <SharedCustomizableChart
              title="Compare (Dual Axis)"
              defaultLeftSeries="baseFee"
              defaultRightSeries="blockLimit"
              dualAxis={true}
            />
            <SharedCustomizableChart
              title="Compare (Same Axis)"
              defaultLeftSeries="cumulativeBaseFee"
              defaultRightSeries="cumulativePriorityFee"
              dualAxis={false}
            />
          </div>

          {/* Row 2: Net Inflation and Milestone Time */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <InflationChart title="Net Inflation (Issuance - Burned)" metric="netInflation" />
            <SharedFullChart title="Milestone Time (seconds)" metric="heimdallBlockTime" />
          </div>

          {/* Row 3: POL Issuance and Bor Block Time */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <InflationChart title="POL Issuance" metric="issuance" />
            <SharedFullChart title="Bor Block Time (seconds)" metric="borBlockTime" />
          </div>

          {/* Standard charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <SharedFullChart title="Gas Price (gwei)" metric="gas" />
            <SharedFullChart title="Finality Time (seconds)" metric="finality" />
            <SharedFullChart title="MGAS/s" metric="mgas" />
            <SharedFullChart title="TPS" metric="tps" />
            <SharedFullChart title="Block Limit (M gas)" metric="blockLimit" />
            <SharedFullChart title="Block Utilization (%)" metric="blockLimitUtilization" />
            <SharedFullChart title="Total Base Fee per Block (POL)" metric="totalBaseFee" />
            <SharedFullChart title="Total Priority Fee per Block (POL)" metric="totalPriorityFee" />
            <SharedFullChart title="Total Fee per Block (POL)" metric="totalFee" />
            <SharedFullChart title="Cumulative Base Fee per Block (POL)" metric="totalBaseFee" showCumulative />
            <SharedFullChart title="Cumulative Priority Fee per Block (POL)" metric="totalPriorityFee" showCumulative />
            <SharedFullChart title="Cumulative Total Fee per Block (POL)" metric="totalFee" showCumulative />
          </div>

          {/* Total Supply Chart */}
          <div className="mb-6">
            <InflationChart title="Total POL Supply" metric="totalSupply" />
          </div>
        </ChartDataProvider>
      </main>
    </div>
  );
}
