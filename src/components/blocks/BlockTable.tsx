'use client';

import { BlockDataUI } from '@/lib/types';
import { getTimeAgo, formatGas, formatGweiToPol, getGasUtilizationColor } from '@/lib/utils';
import { EXTERNAL_URLS } from '@/lib/constants';

interface BlockTableProps {
  blocks: BlockDataUI[];
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
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300" style={{ minWidth: '120px' }}>Gas Used</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Base Fee</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Min Priority</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Median Priority</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Max Priority</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300" title="Total Base Fee (POL)">Base (POL)</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300" title="Total Priority Fee (POL)">Priority (POL)</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Txs</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">MGAS/s</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">TPS</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Finality</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {blocks.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-gray-500">
                  No blocks found
                </td>
              </tr>
            ) : (
              blocks.map((block) => (
                <tr key={block.blockNumber} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-3 py-2">
                    <a
                      href={`${EXTERNAL_URLS.POLYGONSCAN_BLOCK}${block.blockNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline font-mono"
                    >
                      {block.blockNumber}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-gray-500" title={new Date(block.timestamp).toLocaleString()}>
                    {getTimeAgo(new Date(block.timestamp))}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <div className="relative w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4">
                        <div
                          className={`h-4 rounded-full ${getGasUtilizationColor(block.gasUsedPercent)}`}
                          style={{ width: `${Math.min(block.gasUsedPercent, 100)}%` }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-800 dark:text-gray-100">
                          {block.gasUsedPercent.toFixed(2)}%
                        </span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span className="font-mono">{formatGas(block.gasUsed)}</span>
                        <span className="font-mono">/ {formatGas(block.gasLimit)}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{block.baseFeeGwei.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{block.minPriorityFeeGwei.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{block.medianPriorityFeeGwei.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{block.maxPriorityFeeGwei.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{formatGweiToPol(block.totalBaseFeeGwei)}</td>
                  <td className="px-3 py-2 text-right">{formatGweiToPol(block.totalPriorityFeeGwei)}</td>
                  <td className="px-3 py-2 text-right">{block.txCount}</td>
                  <td className="px-3 py-2 text-right">{block.mgasPerSec?.toFixed(1) ?? '-'}</td>
                  <td className="px-3 py-2 text-right">{block.tps?.toFixed(0) ?? '-'}</td>
                  <td className="px-3 py-2 text-right">
                    {block.finalized ? (
                      <span className="text-green-500">
                        {block.timeToFinalitySec !== null ? `${Math.round(block.timeToFinalitySec)}s` : '-'}
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
