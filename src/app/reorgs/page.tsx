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
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="text-gray-400 text-sm">{label}</div>
      <div className="text-2xl font-bold text-gray-100">{value}</div>
      {subLabel && <div className="text-gray-500 text-xs">{subLabel}</div>}
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
    <div className="min-h-screen bg-gray-900">
      <Nav />

      <main className="w-full px-4 py-6 max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-100 mb-6">Chain Reorganizations</h1>

        {loading && !stats && (
          <div className="text-gray-400">Loading...</div>
        )}

        {error && (
          <div className="bg-red-900 text-red-200 p-4 rounded-lg mb-4">
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
            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700">
                <h2 className="text-lg font-semibold text-gray-200">Recent Reorgs</h2>
              </div>

              {reorgs.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-400">
                  No chain reorganizations detected
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-gray-400 text-sm border-b border-gray-700">
                        <th className="px-4 py-3 text-left">Block</th>
                        <th className="px-4 py-3 text-left">Block Time</th>
                        <th className="px-4 py-3 text-left">Original Hash</th>
                        <th className="px-4 py-3 text-left">Replaced By</th>
                        <th className="px-4 py-3 text-left">Detected</th>
                        <th className="px-4 py-3 text-left">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reorgs.map((reorg) => (
                        <tr key={reorg.id} className="border-b border-gray-700 last:border-0 hover:bg-gray-750">
                          <td className="px-4 py-3">
                            <span className="text-blue-400 font-mono">
                              #{reorg.blockNumber}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-300">
                            {new Date(reorg.timestamp).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-gray-400 font-mono text-sm">
                            <span title={reorg.blockHash}>
                              {truncateHash(reorg.blockHash)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-400 font-mono text-sm">
                            {reorg.replacedByHash ? (
                              <span title={reorg.replacedByHash} className="text-green-400">
                                {truncateHash(reorg.replacedByHash)}
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-400">
                            {formatTimeAgo(reorg.reorgedAt)}
                          </td>
                          <td className="px-4 py-3 text-gray-400">
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
            <div className="mt-6 bg-gray-800 rounded-lg p-4">
              <h3 className="text-gray-200 font-semibold mb-2">About Chain Reorganizations</h3>
              <p className="text-gray-400 text-sm">
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
