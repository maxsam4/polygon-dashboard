'use client';

import type { EndpointStat, MethodStat } from '@/lib/queries/rpcStats';

function rateColor(rate: number): string {
  if (rate >= 99) return 'text-success';
  if (rate >= 95) return 'text-warning';
  return 'text-danger';
}

export function EndpointStatsTable({ data }: { data: EndpointStat[] }) {
  if (data.length === 0) {
    return <div className="text-muted text-sm py-4 text-center">No data for this time range</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="terminal-table w-full text-sm">
        <thead>
          <tr>
            <th className="text-left py-2 px-3 text-muted font-medium">Endpoint</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Calls</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Success %</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Timeouts</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Errors</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Avg (ms)</th>
            <th className="text-right py-2 px-3 text-muted font-medium">p50 (ms)</th>
            <th className="text-right py-2 px-3 text-muted font-medium">p95 (ms)</th>
            <th className="text-right py-2 px-3 text-muted font-medium">p99 (ms)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((ep) => (
            <tr key={ep.endpoint} className="border-t border-accent/10">
              <td className="py-2 px-3 font-mono text-foreground text-xs">{ep.endpoint}</td>
              <td className="py-2 px-3 text-right font-mono text-foreground">{ep.total_calls.toLocaleString()}</td>
              <td className={`py-2 px-3 text-right font-mono font-semibold ${rateColor(ep.success_rate)}`}>{ep.success_rate}%</td>
              <td className="py-2 px-3 text-right font-mono text-warning">{ep.timeout_count.toLocaleString()}</td>
              <td className="py-2 px-3 text-right font-mono text-danger">{ep.error_count.toLocaleString()}</td>
              <td className="py-2 px-3 text-right font-mono text-foreground">{ep.avg_response_ms}</td>
              <td className="py-2 px-3 text-right font-mono text-foreground">{ep.p50_response_ms}</td>
              <td className="py-2 px-3 text-right font-mono text-foreground">{ep.p95_response_ms}</td>
              <td className="py-2 px-3 text-right font-mono text-foreground">{ep.p99_response_ms}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MethodStatsTable({ data }: { data: MethodStat[] }) {
  if (data.length === 0) {
    return <div className="text-muted text-sm py-4 text-center">No data for this time range</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="terminal-table w-full text-sm">
        <thead>
          <tr>
            <th className="text-left py-2 px-3 text-muted font-medium">Method</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Calls</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Success %</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Timeouts</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Errors</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Avg (ms)</th>
            <th className="text-right py-2 px-3 text-muted font-medium">p95 (ms)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((m) => (
            <tr key={m.method} className="border-t border-accent/10">
              <td className="py-2 px-3 font-mono text-foreground text-xs">{m.method}</td>
              <td className="py-2 px-3 text-right font-mono text-foreground">{m.total_calls.toLocaleString()}</td>
              <td className={`py-2 px-3 text-right font-mono font-semibold ${rateColor(m.success_rate)}`}>{m.success_rate}%</td>
              <td className="py-2 px-3 text-right font-mono text-warning">{m.timeout_count.toLocaleString()}</td>
              <td className="py-2 px-3 text-right font-mono text-danger">{m.error_count.toLocaleString()}</td>
              <td className="py-2 px-3 text-right font-mono text-foreground">{m.avg_response_ms}</td>
              <td className="py-2 px-3 text-right font-mono text-foreground">{m.p95_response_ms}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
