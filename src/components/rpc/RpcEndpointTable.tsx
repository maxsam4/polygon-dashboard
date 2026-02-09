'use client';

import { EndpointStatus } from '@/hooks/useRpcPolling';

const ENDPOINT_COLORS = [
  '#00FF41', '#00D4FF', '#FFB800', '#FF3B3B',
  '#A855F7', '#F97316', '#14B8A6', '#EC4899',
];

function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return url.slice(0, 40);
  }
}

function StatusBadge({ status, label }: { status: 'ok' | 'warning' | 'error' | 'cors'; label: string }) {
  const colors = {
    ok: 'bg-success/20 text-success',
    warning: 'bg-warning/20 text-warning',
    error: 'bg-danger/20 text-danger',
    cors: 'bg-danger/20 text-danger',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status]}`}>
      {label}
    </span>
  );
}

function getEndpointStatusInfo(ep: EndpointStatus, highestBlock: bigint | null): { status: 'ok' | 'warning' | 'error' | 'cors'; label: string } {
  if (ep.lastError === 'CORS') return { status: 'cors', label: 'CORS' };
  if (ep.chainIdMismatch) return { status: 'error', label: 'Wrong Chain' };
  if (ep.consecutiveErrors >= 5) return { status: 'error', label: 'Down' };
  if (ep.lastError === 'Timeout') return { status: 'error', label: 'Timeout' };
  if (ep.lastError) return { status: 'warning', label: 'Error' };
  if (ep.blockNumber === null) return { status: 'warning', label: 'Pending' };

  // Check lag
  if (highestBlock !== null && ep.blockNumber !== null) {
    const lag = Number(highestBlock - ep.blockNumber);
    if (lag > 5) return { status: 'warning', label: `Lag: ${lag}` };
  }

  return { status: 'ok', label: 'OK' };
}

interface RpcEndpointTableProps {
  endpoints: EndpointStatus[];
  highestBlock: bigint | null;
  fastestUrl: string | null;
}

export function RpcEndpointTable({ endpoints, highestBlock, fastestUrl }: RpcEndpointTableProps) {
  if (endpoints.length === 0) {
    return <div className="text-muted text-sm">No HTTP endpoints configured</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="terminal-table w-full text-sm">
        <thead>
          <tr>
            <th className="text-left py-2 px-3 text-muted font-medium">Endpoint</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Block #</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Latency</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Lag</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Errors</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {endpoints.map((ep, idx) => {
            const { status, label } = getEndpointStatusInfo(ep, highestBlock);
            const lag = (highestBlock !== null && ep.blockNumber !== null)
              ? Number(highestBlock - ep.blockNumber)
              : null;
            const isFastest = ep.url === fastestUrl;
            const color = ENDPOINT_COLORS[idx % ENDPOINT_COLORS.length];

            return (
              <tr key={ep.url} className="border-t border-accent/10">
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-foreground font-mono text-xs truncate max-w-[250px]" title={ep.url}>
                      {truncateUrl(ep.url)}
                    </span>
                    {isFastest && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-success/20 text-success">
                        Fastest
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2 px-3 text-right font-mono text-foreground">
                  {ep.blockNumber !== null ? Number(ep.blockNumber).toLocaleString() : 'N/A'}
                </td>
                <td className="py-2 px-3 text-right font-mono text-foreground">
                  {ep.latencyMs !== null ? `${ep.latencyMs}ms` : '—'}
                </td>
                <td className="py-2 px-3 text-right font-mono">
                  <span className={lag !== null && lag > 2 ? 'text-warning' : 'text-foreground'}>
                    {lag !== null ? (lag === 0 ? '0' : `-${lag}`) : '—'}
                  </span>
                </td>
                <td className="py-2 px-3 text-right font-mono text-foreground">
                  {ep.consecutiveErrors > 0 ? ep.consecutiveErrors : '0'}
                </td>
                <td className="py-2 px-3 text-right">
                  <StatusBadge status={status} label={label} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
