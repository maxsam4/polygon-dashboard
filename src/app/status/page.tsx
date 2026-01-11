'use client';

import { Nav } from '@/components/Nav';
import { useEffect, useState } from 'react';

interface Gap {
  start: string;
  end: string;
  size: number;
}

interface StatusData {
  workersRunning: boolean;
  timestamp: string;
  blocks: {
    min: string | null;
    max: string | null;
    total: number;
    finalized: number;
    minFinalized: string | null;
    maxFinalized: string | null;
    unfinalized: number;
    unfinalizedInMilestoneRange: number;
    gaps: Gap[];
    latest: {
      blockNumber: string;
      timestamp: string;
      age: number;
    } | null;
  };
  milestones: {
    minSeq: string | null;
    maxSeq: string | null;
    minStartBlock: string | null;
    maxEndBlock: string | null;
    total: number;
    gaps: Gap[];
    latest: {
      sequenceId: string;
      endBlock: string;
      timestamp: string;
      age: number;
    } | null;
  };
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`px-2 py-1 rounded text-sm font-medium ${
      ok ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'
    }`}>
      {label}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h3 className="text-lg font-semibold text-gray-200 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function StatRow({ label, value, warning }: { label: string; value: string | number; warning?: boolean | null }) {
  return (
    <div className="flex justify-between py-1 border-b border-gray-700 last:border-0">
      <span className="text-gray-400">{label}</span>
      <span className={warning ? 'text-yellow-400 font-medium' : 'text-gray-200'}>{value}</span>
    </div>
  );
}

export default function StatusPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Failed to fetch status');
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gray-900">
      <Nav />

      <main className="w-full px-4 py-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-100">System Status</h1>
          <div className="flex items-center gap-3">
            {status && (
              <>
                <StatusBadge
                  ok={status.workersRunning}
                  label={status.workersRunning ? 'Workers Running' : 'Workers Stopped'}
                />
                <span className="text-gray-500 text-sm">
                  Updated: {new Date(status.timestamp).toLocaleTimeString()}
                </span>
              </>
            )}
          </div>
        </div>

        {loading && !status && (
          <div className="text-gray-400">Loading...</div>
        )}

        {error && (
          <div className="bg-red-900 text-red-200 p-4 rounded-lg mb-4">
            Error: {error}
          </div>
        )}

        {status && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Blocks Overview */}
            <Card title="Blocks">
              <div className="space-y-1">
                <StatRow label="Latest Block" value={status.blocks.latest?.blockNumber ?? 'N/A'} />
                <StatRow
                  label="Latest Block Age"
                  value={status.blocks.latest ? formatAge(status.blocks.latest.age) : 'N/A'}
                  warning={status.blocks.latest && status.blocks.latest.age > 10}
                />
                <StatRow label="Total Blocks" value={formatNumber(status.blocks.total)} />
                <StatRow label="Block Range" value={`${status.blocks.min ?? 'N/A'} - ${status.blocks.max ?? 'N/A'}`} />
                <StatRow label="Finalized" value={formatNumber(status.blocks.finalized)} />
                <StatRow
                  label="Unfinalized (in milestone range)"
                  value={formatNumber(status.blocks.unfinalizedInMilestoneRange)}
                  warning={status.blocks.unfinalizedInMilestoneRange > 100}
                />
                <StatRow label="Total Unfinalized" value={formatNumber(status.blocks.unfinalized)} />
              </div>
            </Card>

            {/* Milestones Overview */}
            <Card title="Milestones">
              <div className="space-y-1">
                <StatRow label="Latest Sequence" value={status.milestones.latest?.sequenceId ?? 'N/A'} />
                <StatRow
                  label="Latest Milestone Age"
                  value={status.milestones.latest ? formatAge(status.milestones.latest.age) : 'N/A'}
                  warning={status.milestones.latest && status.milestones.latest.age > 30}
                />
                <StatRow label="Latest End Block" value={status.milestones.latest?.endBlock ?? 'N/A'} />
                <StatRow label="Total Milestones" value={formatNumber(status.milestones.total)} />
                <StatRow label="Sequence Range" value={`${status.milestones.minSeq ?? 'N/A'} - ${status.milestones.maxSeq ?? 'N/A'}`} />
                <StatRow label="Block Coverage" value={`${status.milestones.minStartBlock ?? 'N/A'} - ${status.milestones.maxEndBlock ?? 'N/A'}`} />
              </div>
            </Card>

            {/* Block Gaps */}
            <Card title="Block Gaps (last 10k blocks)">
              {status.blocks.gaps.length === 0 ? (
                <div className="text-green-400">No gaps detected</div>
              ) : (
                <div className="space-y-2">
                  {status.blocks.gaps.map((gap, i) => (
                    <div key={i} className="flex justify-between items-center py-1 border-b border-gray-700 last:border-0">
                      <span className="text-gray-400">{gap.start} - {gap.end}</span>
                      <span className="text-yellow-400">{formatNumber(gap.size)} blocks</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Milestone Gaps */}
            <Card title="Milestone Gaps (last 1k milestones)">
              {status.milestones.gaps.length === 0 ? (
                <div className="text-green-400">No gaps detected</div>
              ) : (
                <div className="space-y-2">
                  {status.milestones.gaps.map((gap, i) => (
                    <div key={i} className="flex justify-between items-center py-1 border-b border-gray-700 last:border-0">
                      <span className="text-gray-400">Seq {gap.start} - {gap.end}</span>
                      <span className="text-yellow-400">{formatNumber(gap.size)} milestones</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Sync Status */}
            <Card title="Sync Status">
              <div className="space-y-3">
                <div>
                  <div className="text-gray-400 text-sm mb-1">Block to Milestone Sync</div>
                  {status.blocks.latest && status.milestones.latest ? (
                    <div className="text-gray-200">
                      {(() => {
                        const blockDiff = BigInt(status.blocks.latest.blockNumber) - BigInt(status.milestones.latest.endBlock);
                        const isAhead = blockDiff > 0n;
                        return (
                          <span className={blockDiff > 100n ? 'text-yellow-400' : 'text-green-400'}>
                            Blocks {isAhead ? 'ahead' : 'behind'} milestones by {formatNumber(Math.abs(Number(blockDiff)))}
                          </span>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="text-gray-500">N/A</div>
                  )}
                </div>
                <div>
                  <div className="text-gray-400 text-sm mb-1">Finalization Coverage</div>
                  {status.blocks.finalized > 0 ? (
                    <div className="text-gray-200">
                      {status.blocks.minFinalized} - {status.blocks.maxFinalized}
                      <span className="text-gray-500 ml-2">
                        ({((status.blocks.finalized / status.blocks.total) * 100).toFixed(1)}% finalized)
                      </span>
                    </div>
                  ) : (
                    <div className="text-yellow-400">No finalized blocks yet</div>
                  )}
                </div>
              </div>
            </Card>

            {/* Health Indicators */}
            <Card title="Health Indicators">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Workers</span>
                  <StatusBadge ok={status.workersRunning} label={status.workersRunning ? 'OK' : 'Stopped'} />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Block Freshness</span>
                  <StatusBadge
                    ok={!status.blocks.latest || status.blocks.latest.age < 10}
                    label={status.blocks.latest && status.blocks.latest.age > 10 ? 'Stale' : 'OK'}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Milestone Freshness</span>
                  <StatusBadge
                    ok={!status.milestones.latest || status.milestones.latest.age < 30}
                    label={status.milestones.latest && status.milestones.latest.age > 30 ? 'Stale' : 'OK'}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Block Gaps</span>
                  <StatusBadge
                    ok={status.blocks.gaps.length === 0}
                    label={status.blocks.gaps.length > 0 ? `${status.blocks.gaps.length} gaps` : 'None'}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Milestone Gaps</span>
                  <StatusBadge
                    ok={status.milestones.gaps.length === 0}
                    label={status.milestones.gaps.length > 0 ? `${status.milestones.gaps.length} gaps` : 'None'}
                  />
                </div>
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
