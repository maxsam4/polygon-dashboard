'use client';

import { Nav } from '@/components/Nav';
import { ThresholdEditor } from '@/components/ThresholdEditor';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { UI_CONSTANTS, STATUS_THRESHOLDS } from '@/lib/constants';
import {
  formatAge,
  formatTimeAgo,
  formatNumber,
  formatDateRange,
  calculateSpeeds,
  formatSpeed,
  formatEta,
  HistoricalData,
  SpeedStats,
} from '@/lib/statusUtils';

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
    total: string;
    finalized: string;
    minFinalized: string | null;
    maxFinalized: string | null;
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
    total: string;
    latest: {
      sequenceId: string;
      endBlock: string;
      timestamp: string;
      age: number;
    } | null;
  };
  inflation?: {
    rateCount: number;
    latestRate: string | null;
    lastChange: string | null;
  };
  backfillTargets?: {
    blockTarget: number;
    milestoneTarget: number;
  };
  priorityFeeBackfill?: {
    cursor: string;
    minBlock: string;
    maxBlock: string;
    processedBlocks: string;
    totalBlocks: string;
    isComplete: boolean;
  } | null;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`px-2 py-1 rounded text-sm font-medium ${
      ok ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'
    }`}>
      {label}
    </span>
  );
}

function WorkerStateBadge({ state }: { state: WorkerStatusData['state'] }) {
  const colors = {
    running: 'bg-accent-secondary/20 text-accent-secondary',
    idle: 'bg-success/20 text-success',
    error: 'bg-danger/20 text-danger',
    stopped: 'bg-muted/20 text-muted',
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
    <div className="terminal-card rounded-lg p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent rounded-t-lg" />
      <h3 className="text-lg font-semibold text-foreground mb-3 pt-1">{title}</h3>
      {children}
    </div>
  );
}

function StatRow({ label, value, warning }: { label: string; value: string | number; warning?: boolean | null }) {
  return (
    <div className="flex justify-between py-1 border-b border-accent/10 last:border-0">
      <span className="text-muted">{label}</span>
      <span className={warning ? 'text-warning font-medium' : 'text-foreground'}>{value}</span>
    </div>
  );
}

const MAX_HISTORY = UI_CONSTANTS.MAX_HISTORY_SAMPLES;

export default function AdminPage() {
  const router = useRouter();
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [speeds, setSpeeds] = useState<SpeedStats>({
    backfillerSpeed: null,
    milestoneBackfillerSpeed: null,
    priorityFeeBackfillerSpeed: null,
  });
  const historyRef = useRef<HistoricalData[]>([]);

  // Scan block state (no password needed - authenticated via session)
  const [blockNumberInput, setBlockNumberInput] = useState('');
  const [interestRateInput, setInterestRateInput] = useState('');
  const [isScanningBlock, setIsScanningBlock] = useState(false);
  const [scanBlockResult, setScanBlockResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Logout state
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Failed to fetch status');
      const data: StatusData = await res.json();
      setStatus(data);
      setError(null);

      const historyEntry: HistoricalData = {
        timestamp: Date.now(),
        minBlock: data.blocks.min,
        totalBlocks: data.blocks.total,
        minMilestoneSeq: data.milestones.minSeq,
        totalMilestones: data.milestones.total,
        priorityFeeCursor: data.priorityFeeBackfill?.cursor ?? null,
      };

      const newHistory = [...historyRef.current, historyEntry].slice(-MAX_HISTORY);
      historyRef.current = newHistory;
      setSpeeds(calculateSpeeds(newHistory));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
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
        if (!result.duplicate) {
          fetchStatus();
        }
        setBlockNumberInput('');
        setInterestRateInput('');
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

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
      router.push('/');
      router.refresh();
    } catch {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Nav />

      <main className="w-full px-4 py-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
          <div className="flex items-center gap-3">
            {status && (
              <>
                <StatusBadge
                  ok={status.workersRunning}
                  label={status.workersRunning ? 'Indexers Running' : 'Indexers Stopped'}
                />
                <span className="text-muted text-sm">
                  Updated: {new Date(status.timestamp).toLocaleTimeString()}
                </span>
              </>
            )}
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="px-3 py-1.5 text-sm text-muted hover:text-foreground hover:bg-surface-hover rounded transition-all"
            >
              {isLoggingOut ? 'Signing out...' : 'Sign Out'}
            </button>
          </div>
        </div>

        {loading && !status && (
          <div className="text-muted">Loading...</div>
        )}

        {error && (
          <div className="bg-danger/20 text-danger p-4 rounded-lg mb-4">
            Error: {error}
          </div>
        )}

        {/* Anomaly Thresholds Section */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-foreground mb-4">Anomaly Thresholds</h2>
          <ThresholdEditor />
        </div>

        {status && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Blocks Overview */}
            <Card title="Blocks">
              <div className="space-y-1">
                <StatRow label="Latest Block" value={status.blocks.latest?.blockNumber ?? 'N/A'} />
                <StatRow
                  label="Latest Block Age"
                  value={status.blocks.latest ? formatAge(status.blocks.latest.age) : 'N/A'}
                  warning={status.blocks.latest && status.blocks.latest.age > STATUS_THRESHOLDS.BLOCK_FRESHNESS_SEC}
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
                  warning={status.milestones.latest && status.milestones.latest.age > STATUS_THRESHOLDS.MILESTONE_AGE_WARNING_SEC}
                />
                <StatRow label="Latest End Block" value={status.milestones.latest?.endBlock ?? 'N/A'} />
                <StatRow label="Total Milestones" value={formatNumber(status.milestones.total)} />
                <StatRow label="Sequence Range" value={`${status.milestones.minSeq ?? 'N/A'} - ${status.milestones.maxSeq ?? 'N/A'}`} />
                <StatRow label="Block Coverage" value={`${status.milestones.minStartBlock ?? 'N/A'} - ${status.milestones.maxEndBlock ?? 'N/A'}`} />
                <StatRow label="Time Range" value={formatDateRange(status.milestones.minTimestamp, status.milestones.maxTimestamp)} />
              </div>
            </Card>

            {/* Sync Status */}
            <Card title="Sync Status">
              <div className="space-y-3">
                <div>
                  <div className="text-muted text-sm mb-1">Block to Milestone Sync</div>
                  {status.blocks.latest && status.milestones.latest ? (
                    <div className="text-foreground">
                      {(() => {
                        const blockDiff = BigInt(status.blocks.latest.blockNumber) - BigInt(status.milestones.latest.endBlock);
                        const isAhead = blockDiff > 0n;
                        const absDiff = blockDiff > 0n ? blockDiff : -blockDiff;
                        return (
                          <span className={absDiff > STATUS_THRESHOLDS.BLOCK_DIFF_WARNING ? 'text-warning' : 'text-success'}>
                            Blocks {isAhead ? 'ahead' : 'behind'} milestones by {formatNumber(Math.abs(Number(blockDiff)))}
                          </span>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="text-muted">N/A</div>
                  )}
                </div>
                <div>
                  <div className="text-muted text-sm mb-1">Finalization Coverage</div>
                  {parseInt(status.blocks.finalized) > 0 ? (
                    <div className="text-foreground">
                      {status.blocks.minFinalized} - {status.blocks.maxFinalized}
                      <span className="text-muted ml-2">
                        ({((parseInt(status.blocks.finalized) / parseInt(status.blocks.total)) * 100).toFixed(1)}% finalized)
                      </span>
                    </div>
                  ) : (
                    <div className="text-warning">No finalized blocks yet</div>
                  )}
                </div>
              </div>
            </Card>

            {/* Health Indicators */}
            <Card title="Health Indicators">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-muted">Block Freshness</span>
                  <StatusBadge
                    ok={!status.blocks.latest || status.blocks.latest.age < STATUS_THRESHOLDS.BLOCK_FRESHNESS_SEC}
                    label={status.blocks.latest && status.blocks.latest.age > STATUS_THRESHOLDS.BLOCK_FRESHNESS_SEC ? 'Stale' : 'OK'}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted">Milestone Freshness</span>
                  <StatusBadge
                    ok={!status.milestones.latest || status.milestones.latest.age < STATUS_THRESHOLDS.MILESTONE_AGE_WARNING_SEC}
                    label={status.milestones.latest && status.milestones.latest.age > STATUS_THRESHOLDS.MILESTONE_AGE_WARNING_SEC ? 'Stale' : 'OK'}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted">Indexers</span>
                  <StatusBadge
                    ok={status.workersRunning}
                    label={status.workersRunning ? 'Running' : 'Stopped'}
                  />
                </div>
              </div>
            </Card>

            {/* Progress Stats - Speed and ETA */}
            <Card title="Backfill Progress">
              <div className="space-y-3 text-sm">
                <div className="text-muted text-xs mb-2">
                  {historyRef.current.length < 2
                    ? 'Collecting data...'
                    : `Based on ${historyRef.current.length} samples (${Math.round((historyRef.current[historyRef.current.length - 1].timestamp - historyRef.current[0].timestamp) / 1000)}s)`
                  }
                </div>

                {/* Blocks Backfiller */}
                {(() => {
                  const blockTarget = status.backfillTargets?.blockTarget ?? 50000000;
                  const isBlockBackfillFinished = status.blocks.min !== null &&
                    parseInt(status.blocks.min, 10) <= blockTarget;
                  const remainingBlocks = status.blocks.min
                    ? Math.max(0, parseInt(status.blocks.min, 10) - blockTarget)
                    : 0;
                  return (
                    <div className="py-2 border-b border-accent/10">
                      <div className="flex justify-between items-center">
                        <span className="text-muted">Block Backfiller</span>
                        <span className={`font-mono ${isBlockBackfillFinished ? 'text-success' : 'text-accent-secondary'}`}>
                          {formatSpeed(
                            speeds.backfillerSpeed,
                            'blk',
                            isBlockBackfillFinished,
                            historyRef.current.length >= 2
                          )}
                        </span>
                      </div>
                      {speeds.backfillerSpeed && status.blocks.min && !isBlockBackfillFinished && (
                        <div className="text-muted text-xs mt-1">
                          ETA to target: {formatEta(remainingBlocks, speeds.backfillerSpeed)}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Milestone Backfiller */}
                {(() => {
                  const milestoneTarget = status.backfillTargets?.milestoneTarget ?? 1;
                  const isMilestoneBackfillFinished = status.milestones.minSeq !== null &&
                    parseInt(status.milestones.minSeq, 10) <= milestoneTarget;
                  const remainingMilestones = status.milestones.minSeq
                    ? Math.max(0, parseInt(status.milestones.minSeq, 10) - milestoneTarget)
                    : 0;
                  return (
                    <div className="py-2 border-b border-accent/10">
                      <div className="flex justify-between items-center">
                        <span className="text-muted">Milestone Backfiller</span>
                        <span className={`font-mono ${isMilestoneBackfillFinished ? 'text-success' : 'text-accent'}`}>
                          {formatSpeed(
                            speeds.milestoneBackfillerSpeed,
                            'ms',
                            isMilestoneBackfillFinished,
                            historyRef.current.length >= 2
                          )}
                        </span>
                      </div>
                      {speeds.milestoneBackfillerSpeed && status.milestones.minSeq && !isMilestoneBackfillFinished && (
                        <div className="text-muted text-xs mt-1">
                          ETA to target: {formatEta(remainingMilestones, speeds.milestoneBackfillerSpeed)}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Priority Fee Backfiller */}
                {status.priorityFeeBackfill && (
                  <div className="py-2">
                    <div className="flex justify-between items-center">
                      <span className="text-muted">Priority Fee Recalc</span>
                      <span className={`font-mono ${status.priorityFeeBackfill.isComplete ? 'text-success' : 'text-warning'}`}>
                        {status.priorityFeeBackfill.isComplete
                          ? 'Complete'
                          : formatSpeed(
                              speeds.priorityFeeBackfillerSpeed,
                              'blk',
                              false,
                              historyRef.current.length >= 2
                            )
                        }
                      </span>
                    </div>
                    {!status.priorityFeeBackfill.isComplete && (
                      <>
                        <div className="text-muted text-xs mt-1">
                          {formatNumber(status.priorityFeeBackfill.processedBlocks)} / {formatNumber(status.priorityFeeBackfill.totalBlocks)} blocks
                          ({((parseInt(status.priorityFeeBackfill.processedBlocks) / parseInt(status.priorityFeeBackfill.totalBlocks)) * 100).toFixed(2)}%)
                        </div>
                        {speeds.priorityFeeBackfillerSpeed && (
                          <div className="text-muted text-xs mt-1">
                            ETA: {formatEta(
                              parseInt(status.priorityFeeBackfill.cursor) - parseInt(status.priorityFeeBackfill.minBlock),
                              speeds.priorityFeeBackfillerSpeed
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </Card>

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

              {/* Add New Inflation Rate (no password needed - already authenticated) */}
              <div className="pt-4 border-t border-accent/10">
                <label className="block text-muted text-sm mb-2">
                  Add New Inflation Rate Change
                </label>
                <p className="text-xs text-muted/70 mb-3">
                  Enter the Ethereum block number and INTEREST_PER_YEAR_LOG2 value (in wei, e.g., 28569152196770890)
                </p>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={blockNumberInput}
                    onChange={(e) => setBlockNumberInput(e.target.value)}
                    placeholder="Block number (e.g., 22884776)"
                    className="w-full px-3 py-2 bg-surface dark:bg-surface-elevated text-foreground rounded-lg border border-accent/20 focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
                  />
                  <input
                    type="text"
                    value={interestRateInput}
                    onChange={(e) => setInterestRateInput(e.target.value)}
                    placeholder="Interest rate (e.g., 28569152196770890)"
                    className="w-full px-3 py-2 bg-surface dark:bg-surface-elevated text-foreground rounded-lg border border-accent/20 focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
                  />
                  <button
                    onClick={handleScanBlock}
                    disabled={isScanningBlock}
                    className="w-full px-4 py-2 btn-gradient-active rounded-lg transition-all disabled:opacity-50"
                  >
                    {isScanningBlock ? 'Adding...' : 'Add Rate'}
                  </button>
                </div>
                {scanBlockResult && (
                  <div className={`mt-2 text-sm ${scanBlockResult.success ? 'text-success' : 'text-danger'}`}>
                    {scanBlockResult.message}
                  </div>
                )}
                <div className="mt-3 text-xs text-muted/70">
                  <p className="font-medium mb-1 text-muted">Known values:</p>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>Initial (block 18426253): 42644337408493720</li>
                    <li>Upgrade 1 (block 20678332): 35623909730721220</li>
                    <li>Latest (block 22884776): 28569152196770890</li>
                  </ul>
                </div>
              </div>
            </Card>

            {/* Worker Health */}
            <Card title="Indexer Health">
              <div className="space-y-2">
                {status.workerStatuses.length === 0 ? (
                  <div className="text-muted">No indexer status data yet</div>
                ) : (
                  status.workerStatuses.map((worker) => (
                    <div key={worker.name} className="py-2 border-b border-accent/10 last:border-0">
                      <div className="flex justify-between items-center">
                        <span className="text-foreground font-medium">{worker.name}</span>
                        <WorkerStateBadge state={worker.state} />
                      </div>
                      <div className="flex justify-between items-center mt-1 text-xs">
                        <span className="text-muted">
                          Last run: {worker.lastRunAt ? formatTimeAgo(worker.lastRunAt) : 'Never'}
                        </span>
                        <span className="text-muted">
                          {formatNumber(worker.itemsProcessed)} processed
                        </span>
                      </div>
                      {worker.state === 'error' && worker.lastError && (
                        <div className="mt-1 text-xs text-danger truncate">
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
