'use client';

import { Nav } from '@/components/Nav';
import { RpcEndpointTable } from '@/components/rpc/RpcEndpointTable';
import { BlockNumberChart } from '@/components/rpc/BlockNumberChart';
import { WsTimingChart } from '@/components/rpc/WsTimingChart';
import { useRpcPolling } from '@/hooks/useRpcPolling';
import { useWsBlockRace, WsEndpointStatus } from '@/hooks/useWsBlockRace';
import { useEffect, useState } from 'react';

const ENDPOINT_COLORS = [
  '#00FF41', '#00D4FF', '#FFB800', '#FF3B3B',
  '#A855F7', '#F97316', '#14B8A6', '#EC4899',
];

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="terminal-card rounded-lg p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent rounded-t-lg" />
      <h3 className="text-lg font-semibold text-foreground mb-3 pt-1">{title}</h3>
      {children}
    </div>
  );
}

function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return url.slice(0, 40);
  }
}

function WsStatusBadge({ ep }: { ep: WsEndpointStatus }) {
  if (ep.connected) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-success/20 text-success">
        Connected
      </span>
    );
  }
  if (ep.lastError) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-danger/20 text-danger">
        {ep.lastError}
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded text-xs font-medium bg-warning/20 text-warning">
      Disconnected
    </span>
  );
}

export default function RpcStatusPage() {
  const [httpUrls, setHttpUrls] = useState<string[]>([]);
  const [wsUrls, setWsUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch URLs from API
  useEffect(() => {
    async function fetchUrls() {
      try {
        const res = await fetch('/api/admin/rpc-urls');
        if (res.status === 401) {
          setError('Unauthorized - please log in');
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error('Failed to fetch RPC URLs');
        const data = await res.json();
        setHttpUrls(data.polygonHttp || []);
        setWsUrls(data.polygonWs || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchUrls();
  }, []);

  const { endpoints, highestBlock, history: httpHistory } = useRpcPolling(httpUrls);
  const { wsEndpoints, history: wsHistory } = useWsBlockRace(wsUrls);

  // Find fastest HTTP endpoint
  const fastestUrl = endpoints.reduce<string | null>((best, ep) => {
    if (ep.latencyMs === null || ep.consecutiveErrors > 0) return best;
    const bestEp = endpoints.find(e => e.url === best);
    if (!bestEp || bestEp.latencyMs === null || ep.latencyMs < bestEp.latencyMs) return ep.url;
    return best;
  }, null);

  return (
    <div className="min-h-screen bg-background">
      <Nav />

      <main className="w-full px-4 py-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-foreground">RPC Endpoint Status</h1>
          {highestBlock !== null && (
            <span className="text-muted text-sm font-mono">
              Highest block: {Number(highestBlock).toLocaleString()}
            </span>
          )}
        </div>

        {loading && (
          <div className="text-muted">Loading endpoints...</div>
        )}

        {error && (
          <div className="bg-danger/20 text-danger p-4 rounded-lg mb-4">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-6">
            {/* HTTP Endpoints */}
            <Card title="HTTP Endpoints">
              <RpcEndpointTable
                endpoints={endpoints}
                highestBlock={highestBlock}
                fastestUrl={fastestUrl}
              />
            </Card>

            {/* Block Number History Chart */}
            {httpUrls.length > 0 && (
              <Card title="Block Number History">
                <BlockNumberChart history={httpHistory} urls={httpUrls} />
              </Card>
            )}

            {/* WebSocket Block Race */}
            {wsUrls.length > 0 && (
              <>
                <Card title="WebSocket Block Race">
                  {wsEndpoints.length === 0 ? (
                    <div className="text-muted text-sm">No WebSocket endpoints configured</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="terminal-table w-full text-sm">
                        <thead>
                          <tr>
                            <th className="text-left py-2 px-3 text-muted font-medium">Endpoint</th>
                            <th className="text-right py-2 px-3 text-muted font-medium">Connected</th>
                            <th className="text-right py-2 px-3 text-muted font-medium">Last Block</th>
                            <th className="text-right py-2 px-3 text-muted font-medium">p50</th>
                            <th className="text-right py-2 px-3 text-muted font-medium">p95</th>
                            <th className="text-right py-2 px-3 text-muted font-medium">p99</th>
                            <th className="text-right py-2 px-3 text-muted font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {wsEndpoints.map((ep, idx) => {
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
                                  </div>
                                </td>
                                <td className="py-2 px-3 text-right">
                                  <span className={ep.connected ? 'text-success' : 'text-muted'}>
                                    {ep.connected ? 'Yes' : 'No'}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-right font-mono text-foreground">
                                  {ep.lastBlock !== null ? Number(ep.lastBlock).toLocaleString() : '—'}
                                </td>
                                <td className="py-2 px-3 text-right font-mono text-foreground">
                                  {ep.p50 !== null ? `${ep.p50}ms` : '—'}
                                </td>
                                <td className="py-2 px-3 text-right font-mono text-foreground">
                                  {ep.p95 !== null ? `${ep.p95}ms` : '—'}
                                </td>
                                <td className="py-2 px-3 text-right font-mono text-foreground">
                                  {ep.p99 !== null ? `${ep.p99}ms` : '—'}
                                </td>
                                <td className="py-2 px-3 text-right">
                                  <WsStatusBadge ep={ep} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>

                {/* WS Timing Chart */}
                <Card title="WebSocket Delivery Timing">
                  <WsTimingChart history={wsHistory} urls={wsUrls} />
                </Card>
              </>
            )}

            {httpUrls.length === 0 && wsUrls.length === 0 && (
              <div className="text-muted text-center py-8">
                No RPC endpoints configured. Set POLYGON_RPC_URLS and/or POLYGON_WS_URLS environment variables.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
