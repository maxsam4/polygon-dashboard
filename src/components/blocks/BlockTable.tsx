'use client';

interface BlockData {
  blockNumber: string;
  timestamp: string;
  gasUsedPercent: number;
  baseFeeGwei: number;
  avgPriorityFeeGwei: number;
  medianPriorityFeeGwei: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  txCount: number;
  gasUsed: string;
  gasLimit: string;
  blockTimeSec?: number | null;
  mgasPerSec?: number | null;
  tps?: number | null;
  totalBaseFeeGwei?: number;
  totalPriorityFeeGwei?: number;
  finalized: boolean;
  timeToFinalitySec: number | null;
}

interface BlockTableProps {
  blocks: BlockData[];
  title?: string;
}

export function BlockTable({ blocks, title = 'Latest Blocks' }: BlockTableProps) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Block</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Time</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Gas %</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Base Fee</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Median Priority</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Min Priority</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Max Priority</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Txs</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">MGAS/s</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">TPS</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Finality</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {blocks.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-gray-500">
                  No blocks found
                </td>
              </tr>
            ) : (
              blocks.map((block) => (
                <tr key={block.blockNumber} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-3 py-2">
                    <a
                      href={`https://polygonscan.com/block/${block.blockNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline font-mono"
                    >
                      {block.blockNumber}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-gray-500">{getTimeAgo(new Date(block.timestamp))}</td>
                  <td className="px-3 py-2 text-right">{block.gasUsedPercent.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right font-medium">{block.baseFeeGwei.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{block.medianPriorityFeeGwei.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{block.minPriorityFeeGwei.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{block.maxPriorityFeeGwei.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{block.txCount}</td>
                  <td className="px-3 py-2 text-right">{block.mgasPerSec?.toFixed(1) ?? '-'}</td>
                  <td className="px-3 py-2 text-right">{block.tps?.toFixed(0) ?? '-'}</td>
                  <td className="px-3 py-2 text-right">
                    {block.finalized ? (
                      <span className="text-green-500">
                        {block.timeToFinalitySec !== null
                          ? `${block.timeToFinalitySec.toFixed(1)}s`
                          : '-'}
                      </span>
                    ) : (
                      <span className="text-yellow-500">pending</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
