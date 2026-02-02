'use client';

interface MilestoneData {
  milestoneId: string;
  startBlock: string;
  endBlock: string;
  blockCount: number;
  hash: string;
  proposer: string | null;
  timestamp: string;
  blocksInDb: number;
  avgFinalityTime: number | null;
}

interface Props {
  milestones: MilestoneData[];
  title?: string;
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function MilestoneTable({ milestones, title = 'Milestones' }: Props) {
  return (
    <div className="glass-card-solid rounded-xl overflow-hidden relative">
      {/* Gradient accent at top */}
      <div className="absolute top-0 left-0 right-0 h-0.5 gradient-polygon" />
      <div className="p-4 border-b border-polygon-purple/10 dark:border-polygon-purple/20">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface dark:bg-surface-elevated/50">
            <tr>
              <th className="px-3 py-2 text-left text-text-secondary font-medium">ID</th>
              <th className="px-3 py-2 text-right text-text-secondary font-medium">From Block</th>
              <th className="px-3 py-2 text-right text-text-secondary font-medium">To Block</th>
              <th className="px-3 py-2 text-right text-text-secondary font-medium">Expected</th>
              <th className="px-3 py-2 text-right text-text-secondary font-medium">In DB</th>
              <th className="px-3 py-2 text-right text-text-secondary font-medium">Coverage</th>
              <th className="px-3 py-2 text-left text-text-secondary font-medium">Proposer</th>
              <th className="px-3 py-2 text-left text-text-secondary font-medium">Time</th>
              <th className="px-3 py-2 text-right text-text-secondary font-medium">Avg Finality</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-polygon-purple/10 dark:divide-polygon-purple/15">
            {milestones.map((m) => {
              const coverage = m.blockCount > 0 ? (m.blocksInDb / m.blockCount) * 100 : 0;
              const isComplete = m.blocksInDb === m.blockCount;

              return (
                <tr key={m.milestoneId} className="hover:bg-surface-hover transition-colors">
                  <td className="px-3 py-2 font-mono text-xs text-polygon-purple">{m.milestoneId}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                    {parseInt(m.startBlock).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                    {parseInt(m.endBlock).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                    {m.blockCount.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    <span className={isComplete ? 'text-success' : 'text-warning'}>
                      {m.blocksInDb.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-surface dark:bg-surface-elevated rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            isComplete ? 'bg-success' : coverage > 50 ? 'bg-warning' : 'bg-danger'
                          }`}
                          style={{ width: `${Math.min(coverage, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-text-secondary w-12 text-right">
                        {coverage.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                    {m.proposer ? `${m.proposer.slice(0, 8)}...${m.proposer.slice(-4)}` : '-'}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary" title={m.timestamp}>
                    {getTimeAgo(new Date(m.timestamp))}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {m.avgFinalityTime !== null ? (
                      <span className="text-success">{m.avgFinalityTime.toFixed(1)}s</span>
                    ) : (
                      <span className="text-text-secondary">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
