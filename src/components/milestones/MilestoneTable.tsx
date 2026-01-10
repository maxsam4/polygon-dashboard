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
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-right">From Block</th>
              <th className="px-3 py-2 text-right">To Block</th>
              <th className="px-3 py-2 text-right">Expected</th>
              <th className="px-3 py-2 text-right">In DB</th>
              <th className="px-3 py-2 text-right">Coverage</th>
              <th className="px-3 py-2 text-left">Proposer</th>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-right">Avg Finality</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {milestones.map((m) => {
              const coverage = m.blockCount > 0 ? (m.blocksInDb / m.blockCount) * 100 : 0;
              const isComplete = m.blocksInDb === m.blockCount;

              return (
                <tr key={m.milestoneId} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-3 py-2 font-mono text-xs">{m.milestoneId}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {parseInt(m.startBlock).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {parseInt(m.endBlock).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {m.blockCount.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    <span className={isComplete ? 'text-green-500' : 'text-yellow-500'}>
                      {m.blocksInDb.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${
                            isComplete ? 'bg-green-500' : coverage > 50 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.min(coverage, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 w-12 text-right">
                        {coverage.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {m.proposer ? `${m.proposer.slice(0, 8)}...${m.proposer.slice(-4)}` : '-'}
                  </td>
                  <td className="px-3 py-2 text-xs" title={m.timestamp}>
                    {getTimeAgo(new Date(m.timestamp))}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {m.avgFinalityTime !== null ? `${m.avgFinalityTime.toFixed(1)}s` : '-'}
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
