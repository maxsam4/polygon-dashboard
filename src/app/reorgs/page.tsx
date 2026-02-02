'use client';

import { Nav } from '@/components/Nav';
import { useEffect, useState } from 'react';

interface ReorgData {
  id: number;
  blockNumber: string;
  timestamp: string;
  blockHash: string;
  reorgedAt: string;
  reason: string | null;
  replacedByHash: string | null;
}

interface ReorgStats {
  totalReorgs: number;
  last24Hours: number;
  last7Days: number;
}

function formatTimeAgo(isoString: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function truncateHash(hash: string): string {
  if (hash.length <= 20) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function StatCard({ label, value, subLabel }: { label: string; value: number | string; subLabel?: string }) {
  return (
    <div className="glass-card-solid rounded-xl p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 gradient-polygon" />
      <div className="text-text-secondary text-sm pt-1">{label}</div>
      <div className="text-2xl font-bold text-foreground">{value}</div>
      {subLabel && <div className="text-text-secondary/70 text-xs">{subLabel}</div>}
    </div>
  );
}

export default function ReorgsPage() {
  const [reorgs, setReorgs] = useState<ReorgData[]>([]);
  const [stats, setStats] = useState<ReorgStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReorgs = async () => {
      try {
        const res = await fetch('/api/reorgs');
        if (!res.ok) throw new Error('Failed to fetch reorgs');
        const data = await res.json();
        setReorgs(data.reorgs);
        setStats(data.stats);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchReorgs();
    const interval = setInterval(fetchReorgs, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Nav />

      <main className="w-full px-4 py-6 max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground mb-6">Chain Reorganizations</h1>

        {loading && !stats && (
          <div className="text-text-secondary">Loading...</div>
        )}

        {error && (
          <div className="bg-danger/20 text-danger p-4 rounded-lg mb-4">
            Error: {error}
          </div>
        )}

        {stats && (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <StatCard label="Total Reorgs" value={stats.totalReorgs} subLabel="All time" />
              <StatCard label="Last 24 Hours" value={stats.last24Hours} />
              <StatCard label="Last 7 Days" value={stats.last7Days} />
            </div>

            {/* Reorgs Table */}
            <div className="glass-card-solid rounded-xl overflow-hidden relative">
              <div className="absolute top-0 left-0 right-0 h-0.5 gradient-polygon" />
              <div className="px-4 py-3 border-b border-polygon-purple/10 dark:border-polygon-purple/20">
                <h2 className="text-lg font-semibold text-foreground">Recent Reorgs</h2>
              </div>

              {reorgs.length === 0 ? (
                <div className="px-4 py-8 text-center text-text-secondary">
                  No chain reorganizations detected
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-text-secondary text-sm border-b border-polygon-purple/10 dark:border-polygon-purple/15">
                        <th className="px-4 py-3 text-left font-medium">Block</th>
                        <th className="px-4 py-3 text-left font-medium">Block Time</th>
                        <th className="px-4 py-3 text-left font-medium">Original Hash</th>
                        <th className="px-4 py-3 text-left font-medium">Replaced By</th>
                        <th className="px-4 py-3 text-left font-medium">Detected</th>
                        <th className="px-4 py-3 text-left font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reorgs.map((reorg) => (
                        <tr key={reorg.id} className="border-b border-polygon-purple/10 last:border-0 hover:bg-surface-hover transition-colors">
                          <td className="px-4 py-3">
                            <span className="text-polygon-purple font-mono">
                              #{reorg.blockNumber}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-foreground">
                            {new Date(reorg.timestamp).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-text-secondary font-mono text-sm">
                            <span title={reorg.blockHash}>
                              {truncateHash(reorg.blockHash)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-text-secondary font-mono text-sm">
                            {reorg.replacedByHash ? (
                              <span title={reorg.replacedByHash} className="text-success">
                                {truncateHash(reorg.replacedByHash)}
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="px-4 py-3 text-text-secondary">
                            {formatTimeAgo(reorg.reorgedAt)}
                          </td>
                          <td className="px-4 py-3 text-text-secondary">
                            {reorg.reason || 'chain reorg'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Info Box */}
            <div className="mt-6 glass-card-solid rounded-xl p-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-0.5 gradient-polygon" />
              <h3 className="text-foreground font-semibold mb-2 pt-1">About Chain Reorganizations</h3>
              <p className="text-text-secondary text-sm">
                A chain reorganization (reorg) occurs when the canonical chain changes due to a competing
                block being accepted. This typically happens when multiple validators propose blocks at
                similar times, and the network eventually converges on a single chain. The blocks shown
                here were previously indexed but were later replaced by different blocks at the same height.
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
