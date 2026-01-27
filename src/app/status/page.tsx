'use client';

import { Nav } from '@/components/Nav';
import { useEffect, useState, useRef } from 'react';

interface Gap {
  start: string;
  end: string;
  size: number;
  source: string;
  createdAt: string;
}

interface GapStats {
  pendingCount: number;
  totalPendingSize: number;
  fillingCount: number;
}

interface Coverage {
  lowWaterMark: string;
  highWaterMark: string;
  lastAnalyzedAt: string | null;
}

interface WorkerStatusData {
  name: string;
  state: 'running' | 'idle' | 'error' | 'stopped';
  lastRunAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  itemsProcessed: number;
}

interface StatusData {
  workersRunning: boolean;
  workerStatuses: WorkerStatusData[];
  timestamp: string;
  blocks: {
    min: string | null;
    max: string | null;
    minTimestamp: string | null;
    maxTimestamp: string | null;
    total: number;
    finalized: number;
    minFinalized: string | null;
    maxFinalized: string | null;
    gaps: Gap[];
    gapStats: GapStats;
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
    minTimestamp: string | null;
    maxTimestamp: string | null;
    total: number;
    gaps: Gap[];
    gapStats: GapStats;
    latest: {
      sequenceId: string;
      endBlock: string;
      timestamp: string;
      age: number;
    } | null;
  };
  finality: {
    gaps: Gap[];
    gapStats: GapStats;
  };
  coverage: {
    blocks: Coverage | null;
    milestones: Coverage | null;
  };
  inflation?: {
    rateCount: number;
    latestRate: string | null;
    lastChange: string | null;
  };
  priorityFeeFix?: {
    fixDeployedAtBlock: string | null;
    lastFixedBlock: string | null;
    earliestBlock: string | null;
    totalToFix: string;
    totalFixed: string;
    percentComplete: number;
    isComplete: boolean;
  } | null;
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatTimeAgo(isoString: string | null): string {
  if (!isoString) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  return formatAge(seconds) + ' ago';
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

interface HistoricalData {
  timestamp: number;
  minBlock: string | null;
  totalBlocks: number;
  minMilestoneSeq: string | null;
  totalMilestones: number;
  blockGapSize: number;
  milestoneGapSize: number;
  finalityGapSize: number;
  priorityFeeLastFixedBlock?: string;
}

interface SpeedStats {
  backfillerSpeed: number | null;      // blocks/sec (going backwards)
  blockGapSpeed: number | null;         // blocks/sec (gap filling)
  milestoneBackfillerSpeed: number | null; // milestones/sec
  milestoneGapSpeed: number | null;     // milestones/sec
  priorityFeeFixSpeed: number | null;   // blocks/sec (priority fee fixing)
}

function calculateSpeeds(history: HistoricalData[]): SpeedStats {
  if (history.length < 2) {
    return {
      backfillerSpeed: null,
      blockGapSpeed: null,
      milestoneBackfillerSpeed: null,
      milestoneGapSpeed: null,
      priorityFeeFixSpeed: null,
    };
  }

  const oldest = history[0];
  const newest = history[history.length - 1];
  const timeDiffSec = (newest.timestamp - oldest.timestamp) / 1000;

  if (timeDiffSec < 1) {
    return {
      backfillerSpeed: null,
      blockGapSpeed: null,
      milestoneBackfillerSpeed: null,
      milestoneGapSpeed: null,
      priorityFeeFixSpeed: null,
    };
  }

  // Backfiller speed: how fast min block is decreasing
  let backfillerSpeed: number | null = null;
  if (oldest.minBlock && newest.minBlock) {
    const oldMin = BigInt(oldest.minBlock);
    const newMin = BigInt(newest.minBlock);
    if (newMin < oldMin) {
      backfillerSpeed = Number(oldMin - newMin) / timeDiffSec;
    }
  }

  // Block gap speed: how fast gap size is decreasing
  let blockGapSpeed: number | null = null;
  if (oldest.blockGapSize > newest.blockGapSize) {
    blockGapSpeed = (oldest.blockGapSize - newest.blockGapSize) / timeDiffSec;
  }

  // Milestone backfiller speed: how fast min seq is decreasing
  let milestoneBackfillerSpeed: number | null = null;
  if (oldest.minMilestoneSeq && newest.minMilestoneSeq) {
    const oldMinSeq = parseInt(oldest.minMilestoneSeq, 10);
    const newMinSeq = parseInt(newest.minMilestoneSeq, 10);
    if (newMinSeq < oldMinSeq) {
      milestoneBackfillerSpeed = (oldMinSeq - newMinSeq) / timeDiffSec;
    }
  }

  // Milestone gap speed: how fast gap size is decreasing
  let milestoneGapSpeed: number | null = null;
  if (oldest.milestoneGapSize > newest.milestoneGapSize) {
    milestoneGapSpeed = (oldest.milestoneGapSize - newest.milestoneGapSize) / timeDiffSec;
  }

  // Priority fee fix speed: how fast last fixed block is decreasing
  let priorityFeeFixSpeed: number | null = null;
  if (oldest.priorityFeeLastFixedBlock && newest.priorityFeeLastFixedBlock) {
    const oldBlock = BigInt(oldest.priorityFeeLastFixedBlock);
    const newBlock = BigInt(newest.priorityFeeLastFixedBlock);
    if (newBlock < oldBlock) {
      priorityFeeFixSpeed = Number(oldBlock - newBlock) / timeDiffSec;
    }
  }

  return {
    backfillerSpeed,
    blockGapSpeed,
    milestoneBackfillerSpeed,
    milestoneGapSpeed,
    priorityFeeFixSpeed,
  };
}

function formatSpeed(speed: number | null, unit: string, isFinished?: boolean, isCalculating?: boolean): string {
  if (isFinished) return 'Finished';
  if (speed === null || speed <= 0) {
    return isCalculating ? 'Calculating...' : '-';
  }
  if (speed >= 1000) {
    return `${(speed / 1000).toFixed(1)}k ${unit}/s`;
  }
  return `${speed.toFixed(1)} ${unit}/s`;
}

function formatEta(remaining: number, speed: number | null): string {
  if (speed === null || speed <= 0 || remaining <= 0) return '-';
  const seconds = remaining / speed;
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}

function formatDateRange(minTimestamp: string | null, maxTimestamp: string | null): string {
  if (!minTimestamp || !maxTimestamp) return 'N/A';
  const min = new Date(minTimestamp);
  const max = new Date(maxTimestamp);
  return `${min.toLocaleString()} - ${max.toLocaleString()}`;
}

function estimateBlockDate(
  blockNumber: string | null,
  refBlock: string | null,
  refTimestamp: string | null
): string | null {
  if (!blockNumber || !refBlock || !refTimestamp) return null;
  const block = BigInt(blockNumber);
  const ref = BigInt(refBlock);
  const refTime = new Date(refTimestamp).getTime();
  // Polygon ~2.2 seconds per block
  const msOffset = Number(ref - block) * 2200;
  return new Date(refTime - msOffset).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
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

function WorkerStateBadge({ state }: { state: WorkerStatusData['state'] }) {
  const colors = {
    running: 'bg-blue-900 text-blue-200',
    idle: 'bg-green-900 text-green-200',
    error: 'bg-red-900 text-red-200',
    stopped: 'bg-gray-700 text-gray-300',
  };
  const labels = {
    running: 'Running',
    idle: 'Idle',
    error: 'Error',
    stopped: 'Stopped',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[state]}`}>
      {labels[state]}
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

function GapCard({ title, gaps, gapStats, unitLabel }: { title: string; gaps: Gap[]; gapStats: GapStats; unitLabel: string }) {
  return (
    <Card title={title}>
      <div className="mb-3 text-sm">
        <span className={gapStats.pendingCount > 0 ? 'text-yellow-400' : 'text-green-400'}>
          {gapStats.pendingCount} pending
        </span>
        {gapStats.fillingCount > 0 && (
          <span className="text-blue-400 ml-3">{gapStats.fillingCount} filled</span>
        )}
        {gapStats.totalPendingSize > 0 && (
          <span className="text-gray-500 ml-3">({formatNumber(gapStats.totalPendingSize)} total {unitLabel})</span>
        )}
      </div>
      {gaps.length === 0 ? (
        <div className="text-green-400">No gaps detected</div>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {gaps.map((gap, i) => (
            <div key={i} className="flex justify-between items-center py-1 border-b border-gray-700 last:border-0">
              <div>
                <span className="text-gray-400">{gap.start} - {gap.end}</span>
                <span className="text-gray-600 text-xs ml-2">({gap.source})</span>
              </div>
              <span className="text-yellow-400">{formatNumber(gap.size)} {unitLabel}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const MAX_HISTORY = 12; // 12 samples at 5s = 60 seconds of history

export default function StatusPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [speeds, setSpeeds] = useState<SpeedStats>({
    backfillerSpeed: null,
    blockGapSpeed: null,
    milestoneBackfillerSpeed: null,
    milestoneGapSpeed: null,
    priorityFeeFixSpeed: null,
  });
  const historyRef = useRef<HistoricalData[]>([]);

  // Scan block state
  const [blockNumberInput, setBlockNumberInput] = useState('');
  const [interestRateInput, setInterestRateInput] = useState('');
  const [addRatePassword, setAddRatePassword] = useState('');
  const [isScanningBlock, setIsScanningBlock] = useState(false);
  const [scanBlockResult, setScanBlockResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Failed to fetch status');
      const data: StatusData = await res.json();
      setStatus(data);
      setError(null);

      // Add to history for speed calculations
      const historyEntry: HistoricalData = {
        timestamp: Date.now(),
        minBlock: data.blocks.min,
        totalBlocks: data.blocks.total,
        minMilestoneSeq: data.milestones.minSeq,
        totalMilestones: data.milestones.total,
        blockGapSize: data.blocks.gapStats.totalPendingSize,
        milestoneGapSize: data.milestones.gapStats.totalPendingSize,
        finalityGapSize: data.finality.gapStats.totalPendingSize,
        priorityFeeLastFixedBlock: data.priorityFeeFix?.lastFixedBlock ?? undefined,
      };

      const newHistory = [...historyRef.current, historyEntry].slice(-MAX_HISTORY);
      historyRef.current = newHistory;

      // Calculate speeds from history
      setSpeeds(calculateSpeeds(newHistory));
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

  const handleScanBlock = async () => {
    if (!blockNumberInput || isNaN(Number(blockNumberInput))) {
      setScanBlockResult({
        success: false,
        message: 'Please enter a valid block number',
      });
      return;
    }

    if (!interestRateInput || isNaN(Number(interestRateInput))) {
      setScanBlockResult({
        success: false,
        message: 'Please enter a valid interest rate',
      });
      return;
    }

    setIsScanningBlock(true);
    setScanBlockResult(null);
    try {
      const response = await fetch('/api/inflation/scan-block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blockNumber: blockNumberInput,
          interestPerYearLog2: interestRateInput,
          password: addRatePassword,
        }),
      });
      const result = await response.json();

      if (result.success) {
        setScanBlockResult({
          success: true,
          message: result.duplicate
            ? 'Rate already exists in database'
            : 'New inflation rate added successfully!',
        });
        // Refresh status after adding new rate
        if (!result.duplicate) {
          fetchStatus();
        }
        // Clear inputs on success
        setBlockNumberInput('');
        setInterestRateInput('');
        setBlockNumberInput('');
      } else {
        setScanBlockResult({
          success: false,
          message: result.error || 'Failed to scan block',
        });
      }
    } catch {
      setScanBlockResult({
        success: false,
        message: 'Failed to scan block',
      });
    } finally {
      setIsScanningBlock(false);
    }
  };

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
                <StatRow label="Time Range" value={formatDateRange(status.blocks.minTimestamp, status.blocks.maxTimestamp)} />
                <StatRow label="Finalized Blocks" value={formatNumber(status.blocks.finalized)} />
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
                <StatRow label="Time Range" value={formatDateRange(status.milestones.minTimestamp, status.milestones.maxTimestamp)} />
              </div>
            </Card>

            {/* Data Coverage */}
            <Card title="Data Coverage (Validated Ranges)">
              <div className="space-y-4">
                <div>
                  <div className="text-gray-400 text-sm mb-1 font-medium">Blocks</div>
                  {status.coverage.blocks ? (
                    <div className="space-y-1">
                      <StatRow label="Low Water Mark" value={status.coverage.blocks.lowWaterMark} />
                      <StatRow label="High Water Mark" value={status.coverage.blocks.highWaterMark} />
                      <StatRow label="Last Analyzed" value={formatTimeAgo(status.coverage.blocks.lastAnalyzedAt)} />
                    </div>
                  ) : (
                    <div className="text-gray-500">Not analyzed yet</div>
                  )}
                </div>
                <div>
                  <div className="text-gray-400 text-sm mb-1 font-medium">Milestones</div>
                  {status.coverage.milestones ? (
                    <div className="space-y-1">
                      <StatRow label="Low Water Mark" value={status.coverage.milestones.lowWaterMark} />
                      <StatRow label="High Water Mark" value={status.coverage.milestones.highWaterMark} />
                      <StatRow label="Last Analyzed" value={formatTimeAgo(status.coverage.milestones.lastAnalyzedAt)} />
                    </div>
                  ) : (
                    <div className="text-gray-500">Not analyzed yet</div>
                  )}
                </div>
              </div>
            </Card>

            {/* Gap Statistics */}
            <Card title="Gap Statistics">
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-gray-700">
                  <span className="text-gray-400">Block Gaps</span>
                  <div className="text-right">
                    <span className={status.blocks.gapStats.pendingCount > 0 ? 'text-yellow-400' : 'text-green-400'}>
                      {status.blocks.gapStats.pendingCount} pending
                    </span>
                    {status.blocks.gapStats.fillingCount > 0 && (
                      <span className="text-blue-400 ml-2">({status.blocks.gapStats.fillingCount} filled)</span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-gray-700">
                  <span className="text-gray-400">Milestone Gaps</span>
                  <div className="text-right">
                    <span className={status.milestones.gapStats.pendingCount > 0 ? 'text-yellow-400' : 'text-green-400'}>
                      {status.milestones.gapStats.pendingCount} pending
                    </span>
                    {status.milestones.gapStats.fillingCount > 0 && (
                      <span className="text-blue-400 ml-2">({status.milestones.gapStats.fillingCount} filled)</span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-gray-400">Finality Gaps</span>
                  <div className="text-right">
                    <span className={status.finality.gapStats.pendingCount > 0 ? 'text-yellow-400' : 'text-green-400'}>
                      {status.finality.gapStats.pendingCount} pending
                    </span>
                    {status.finality.gapStats.fillingCount > 0 && (
                      <span className="text-blue-400 ml-2">({status.finality.gapStats.fillingCount} filled)</span>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            {/* Block Gaps */}
            <GapCard
              title="Block Gaps"
              gaps={status.blocks.gaps}
              gapStats={status.blocks.gapStats}
              unitLabel="blocks"
            />

            {/* Milestone Gaps */}
            <GapCard
              title="Milestone Gaps"
              gaps={status.milestones.gaps}
              gapStats={status.milestones.gapStats}
              unitLabel="milestones"
            />

            {/* Finality Gaps */}
            <GapCard
              title="Pending Finality Gaps"
              gaps={status.finality.gaps}
              gapStats={status.finality.gapStats}
              unitLabel="blocks"
            />

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
                    ok={status.blocks.gapStats.pendingCount === 0}
                    label={status.blocks.gapStats.pendingCount > 0 ? `${status.blocks.gapStats.pendingCount} pending` : 'None'}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Milestone Gaps</span>
                  <StatusBadge
                    ok={status.milestones.gapStats.pendingCount === 0}
                    label={status.milestones.gapStats.pendingCount > 0 ? `${status.milestones.gapStats.pendingCount} pending` : 'None'}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Finality Gaps</span>
                  <StatusBadge
                    ok={status.finality.gapStats.pendingCount === 0}
                    label={status.finality.gapStats.pendingCount > 0 ? `${status.finality.gapStats.pendingCount} pending` : 'None'}
                  />
                </div>
              </div>
            </Card>

            {/* Progress Stats - Speed and ETA */}
            <Card title="Progress Stats">
              <div className="space-y-3 text-sm">
                <div className="text-gray-500 text-xs mb-2">
                  {historyRef.current.length < 2
                    ? 'Collecting data...'
                    : `Based on ${historyRef.current.length} samples (${Math.round((historyRef.current[historyRef.current.length - 1].timestamp - historyRef.current[0].timestamp) / 1000)}s)`
                  }
                </div>

                {/* Blocks Backfiller */}
                <div className="py-2 border-b border-gray-700">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Blocks Backfiller</span>
                    <span className={`font-mono ${status.blocks.min === '0' ? 'text-green-400' : 'text-blue-400'}`}>
                      {formatSpeed(
                        speeds.backfillerSpeed,
                        'blk',
                        status.blocks.min === '0',
                        historyRef.current.length >= 2
                      )}
                    </span>
                  </div>
                  {speeds.backfillerSpeed && status.blocks.min && status.blocks.min !== '0' && (
                    <div className="text-gray-500 text-xs mt-1">
                      ETA to block 0: {formatEta(parseInt(status.blocks.min, 10), speeds.backfillerSpeed)}
                    </div>
                  )}
                </div>

                {/* Block Gap Filler */}
                {status.blocks.gapStats.totalPendingSize > 0 && (
                  <div className="py-2 border-b border-gray-700">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Block Gap Filler</span>
                      <span className={`font-mono ${speeds.blockGapSpeed ? 'text-yellow-400' : 'text-gray-400'}`}>
                        {formatSpeed(speeds.blockGapSpeed, 'blk', false, historyRef.current.length >= 2)}
                      </span>
                    </div>
                    {speeds.blockGapSpeed && (
                      <div className="text-gray-500 text-xs mt-1">
                        ETA: {formatEta(status.blocks.gapStats.totalPendingSize, speeds.blockGapSpeed)}
                        <span className="ml-2">({formatNumber(status.blocks.gapStats.totalPendingSize)} remaining)</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Milestone Backfiller */}
                <div className="py-2 border-b border-gray-700">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Milestone Backfiller</span>
                    <span className={`font-mono ${status.milestones.minSeq === '1' ? 'text-green-400' : 'text-purple-400'}`}>
                      {formatSpeed(
                        speeds.milestoneBackfillerSpeed,
                        'ms',
                        status.milestones.minSeq === '1',
                        historyRef.current.length >= 2
                      )}
                    </span>
                  </div>
                  {speeds.milestoneBackfillerSpeed && status.milestones.minSeq && status.milestones.minSeq !== '1' && (
                    <div className="text-gray-500 text-xs mt-1">
                      ETA to seq 1: {formatEta(parseInt(status.milestones.minSeq, 10) - 1, speeds.milestoneBackfillerSpeed)}
                    </div>
                  )}
                </div>

                {/* Milestone Gap Filler */}
                {status.milestones.gapStats.totalPendingSize > 0 && (
                  <div className="py-2">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Milestone Gap Filler</span>
                      <span className={`font-mono ${speeds.milestoneGapSpeed ? 'text-orange-400' : 'text-gray-400'}`}>
                        {formatSpeed(speeds.milestoneGapSpeed, 'ms', false, historyRef.current.length >= 2)}
                      </span>
                    </div>
                    {speeds.milestoneGapSpeed && (
                      <div className="text-gray-500 text-xs mt-1">
                        ETA: {formatEta(status.milestones.gapStats.totalPendingSize, speeds.milestoneGapSpeed)}
                        <span className="ml-2">({formatNumber(status.milestones.gapStats.totalPendingSize)} remaining)</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>

            {/* Priority Fee Fix Progress */}
            {status.priorityFeeFix && (
              <Card title="Priority Fee Data Fix">
                <div className="space-y-3">
                  <div className="mb-3">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-gray-400 text-sm">Progress</span>
                      <span className={status.priorityFeeFix.isComplete ? 'text-green-400' : 'text-blue-400'}>
                        {status.priorityFeeFix.percentComplete.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${status.priorityFeeFix.isComplete ? 'bg-green-500' : 'bg-blue-500'}`}
                        style={{ width: `${Math.min(100, status.priorityFeeFix.percentComplete)}%` }}
                      />
                    </div>
                  </div>
                  <StatRow
                    label="Status"
                    value={status.priorityFeeFix.isComplete ? 'Complete' : 'In Progress'}
                  />
                  <StatRow
                    label="Blocks Fixed"
                    value={`${formatNumber(parseInt(status.priorityFeeFix.totalFixed))} / ${formatNumber(parseInt(status.priorityFeeFix.totalToFix))}`}
                  />
                  {!status.priorityFeeFix.isComplete && (
                    <div className="py-2 border-b border-gray-700">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Speed</span>
                        <span className={`font-mono ${speeds.priorityFeeFixSpeed ? 'text-blue-400' : 'text-gray-400'}`}>
                          {formatSpeed(speeds.priorityFeeFixSpeed, 'blk', false, historyRef.current.length >= 2)}
                        </span>
                      </div>
                      {speeds.priorityFeeFixSpeed && (
                        <div className="text-gray-500 text-xs mt-1">
                          ETA: {formatEta(
                            parseInt(status.priorityFeeFix.totalToFix) - parseInt(status.priorityFeeFix.totalFixed),
                            speeds.priorityFeeFixSpeed
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <StatRow
                    label="Correct Data From"
                    value={
                      status.priorityFeeFix.fixDeployedAtBlock
                        ? `${formatNumber(parseInt(status.priorityFeeFix.fixDeployedAtBlock))} (${estimateBlockDate(status.priorityFeeFix.fixDeployedAtBlock, status.blocks.latest?.blockNumber ?? null, status.blocks.latest?.timestamp ?? null) ?? 'N/A'})`
                        : 'N/A'
                    }
                  />
                  <StatRow
                    label="Last Fixed Block"
                    value={
                      status.priorityFeeFix.lastFixedBlock
                        ? `${formatNumber(parseInt(status.priorityFeeFix.lastFixedBlock))} (${estimateBlockDate(status.priorityFeeFix.lastFixedBlock, status.blocks.latest?.blockNumber ?? null, status.blocks.latest?.timestamp ?? null) ?? 'N/A'})`
                        : 'N/A'
                    }
                  />
                  <StatRow
                    label="Earliest Block"
                    value={
                      status.priorityFeeFix.earliestBlock
                        ? `${formatNumber(parseInt(status.priorityFeeFix.earliestBlock))} (${estimateBlockDate(status.priorityFeeFix.earliestBlock, status.blocks.latest?.blockNumber ?? null, status.blocks.latest?.timestamp ?? null) ?? 'N/A'})`
                        : 'N/A'
                    }
                  />
                  <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-700">
                    Fixing historical priority fee calculations (using gasUsed instead of gas limit)
                  </div>
                </div>
              </Card>
            )}

            {/* POL Inflation Rate */}
            <Card title="POL Inflation Rate">
              <div className="space-y-1 mb-4">
                <StatRow
                  label="Current Rate"
                  value={status?.inflation?.latestRate
                    ? `${((Math.pow(2, parseFloat(status.inflation.latestRate) / 1e18) - 1) * 100).toFixed(2)}%`
                    : 'N/A'}
                />
                <StatRow label="Stored Rates" value={status?.inflation?.rateCount ?? 'N/A'} />
                <StatRow
                  label="Last Change"
                  value={status?.inflation?.lastChange
                    ? new Date(status.inflation.lastChange).toLocaleString()
                    : 'Never'}
                />
              </div>

              {/* Add New Inflation Rate */}
              <div className="pt-4 border-t border-gray-700">
                <label className="block text-gray-400 text-sm mb-2">
                  Add New Inflation Rate Change
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  Enter the Ethereum block number and INTEREST_PER_YEAR_LOG2 value (in wei, e.g., 28569152196770890)
                </p>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={blockNumberInput}
                    onChange={(e) => setBlockNumberInput(e.target.value)}
                    placeholder="Block number (e.g., 22884776)"
                    className="w-full px-3 py-2 bg-gray-700 text-gray-200 rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
                  />
                  <input
                    type="text"
                    value={interestRateInput}
                    onChange={(e) => setInterestRateInput(e.target.value)}
                    placeholder="Interest rate (e.g., 28569152196770890)"
                    className="w-full px-3 py-2 bg-gray-700 text-gray-200 rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
                  />
                  <input
                    type="password"
                    value={addRatePassword}
                    onChange={(e) => setAddRatePassword(e.target.value)}
                    placeholder="Password"
                    className="w-full px-3 py-2 bg-gray-700 text-gray-200 rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleScanBlock}
                    disabled={isScanningBlock}
                    className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white rounded-lg transition-colors"
                  >
                    {isScanningBlock ? 'Adding...' : 'Add Rate'}
                  </button>
                </div>
                {scanBlockResult && (
                  <div className={`mt-2 text-sm ${scanBlockResult.success ? 'text-green-400' : 'text-red-400'}`}>
                    {scanBlockResult.message}
                  </div>
                )}
                <div className="mt-3 text-xs text-gray-500">
                  <p className="font-medium mb-1">Known values:</p>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>Initial (block 18426253): 42644337408493720</li>
                    <li>Upgrade 1 (block 20678332): 35623909730721220</li>
                    <li>Latest (block 22884776): 28569152196770890</li>
                  </ul>
                </div>
              </div>
            </Card>

            {/* Worker Health */}
            <Card title="Worker Health">
              <div className="space-y-2">
                {status.workerStatuses.length === 0 ? (
                  <div className="text-gray-500">No worker status data yet</div>
                ) : (
                  status.workerStatuses.map((worker) => (
                    <div key={worker.name} className="py-2 border-b border-gray-700 last:border-0">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-300 font-medium">{worker.name}</span>
                        <WorkerStateBadge state={worker.state} />
                      </div>
                      <div className="flex justify-between items-center mt-1 text-xs">
                        <span className="text-gray-500">
                          Last run: {worker.lastRunAt ? formatTimeAgo(worker.lastRunAt) : 'Never'}
                        </span>
                        <span className="text-gray-500">
                          {formatNumber(worker.itemsProcessed)} processed
                        </span>
                      </div>
                      {worker.state === 'error' && worker.lastError && (
                        <div className="mt-1 text-xs text-red-400 truncate">
                          Error: {worker.lastError}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
