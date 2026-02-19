'use client';

import { Nav } from '@/components/Nav';
import { EndpointStatsTable, MethodStatsTable } from '@/components/rpc/RpcStatsTable';
import { RpcPerformanceChart } from '@/components/rpc/RpcPerformanceChart';
import { useRpcStats } from '@/hooks/useRpcStats';

const TIME_RANGES = ['1H', '6H', '1D'] as const;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="terminal-card rounded-lg p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent rounded-t-lg" />
      <h3 className="text-lg font-semibold text-foreground mb-3 pt-1">{title}</h3>
      {children}
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="terminal-card rounded-lg p-4 text-center">
      <div className="text-muted text-xs font-medium uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-bold text-foreground font-mono">{value}</div>
      {sub && <div className="text-muted text-xs mt-1">{sub}</div>}
    </div>
  );
}

export default function RpcStatsPage() {
  const { timeRange, setTimeRange, summary, timeseries, loading, error } = useRpcStats();

  // Compute summary totals
  const totalCalls = summary?.endpoints.reduce((sum, ep) => sum + ep.total_calls, 0) ?? 0;
  const totalSuccess = summary?.endpoints.reduce((sum, ep) => sum + ep.success_count, 0) ?? 0;
  const totalTimeouts = summary?.endpoints.reduce((sum, ep) => sum + ep.timeout_count, 0) ?? 0;
  const overallSuccessRate = totalCalls > 0 ? ((totalSuccess / totalCalls) * 100).toFixed(1) : '—';
  const overallTimeoutRate = totalCalls > 0 ? ((totalTimeouts / totalCalls) * 100).toFixed(1) : '—';
  const avgResponseMs = summary?.endpoints.length
    ? (summary.endpoints.reduce((sum, ep) => sum + ep.avg_response_ms * ep.total_calls, 0) / totalCalls).toFixed(0)
    : '—';

  return (
    <div className="min-h-screen bg-background">
      <Nav />

      <main className="w-full px-4 py-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-foreground">RPC Performance Stats</h1>
          <div className="flex gap-1">
            {TIME_RANGES.map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-all duration-150 ${
                  timeRange === range
                    ? 'btn-gradient-active'
                    : 'text-muted hover:text-accent hover:bg-surface-hover'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>

        {loading && <div className="text-muted">Loading stats...</div>}

        {error && (
          <div className="bg-danger/20 text-danger p-4 rounded-lg mb-4">{error}</div>
        )}

        {!loading && !error && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard label="Total Calls" value={totalCalls.toLocaleString()} />
              <SummaryCard label="Success Rate" value={`${overallSuccessRate}%`} />
              <SummaryCard label="Avg Response" value={`${avgResponseMs}ms`} />
              <SummaryCard label="Timeout Rate" value={`${overallTimeoutRate}%`} sub={`${totalTimeouts.toLocaleString()} timeouts`} />
            </div>

            {/* Endpoint Stats */}
            <Card title="Endpoint Performance">
              <EndpointStatsTable data={summary?.endpoints ?? []} />
            </Card>

            {/* Method Stats */}
            <Card title="Method Breakdown">
              <MethodStatsTable data={summary?.methods ?? []} />
            </Card>

            {/* Charts */}
            {timeseries.length > 0 && (
              <>
                <Card title="Response Time (p95)">
                  <RpcPerformanceChart
                    data={timeseries}
                    valueKey="p95_response_ms"
                    title="p95 response time per endpoint"
                  />
                </Card>

                <Card title="Success Rate">
                  <RpcPerformanceChart
                    data={timeseries}
                    valueKey="success_rate"
                    title="Success rate % per endpoint"
                  />
                </Card>
              </>
            )}

            {totalCalls === 0 && (
              <div className="text-muted text-center py-8">
                No RPC stats recorded yet. Stats accumulate as indexers make RPC calls.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
