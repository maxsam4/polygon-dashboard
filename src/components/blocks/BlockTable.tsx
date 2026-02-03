'use client';

import Link from 'next/link';
import { BlockDataUI } from '@/lib/types';
import { getTimeAgo, formatGas, formatGweiToPol, getGasUtilizationColor } from '@/lib/utils';

interface BlockTableProps {
  blocks: BlockDataUI[];
  title?: string;
}

export function BlockTable({ blocks, title = 'Latest Blocks' }: BlockTableProps) {
  return (
    <div className="terminal-card rounded-lg overflow-hidden relative">
      {/* Accent bar at top */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent rounded-t-lg" />
      <div className="p-4 border-b border-accent/10">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="terminal-table">
          <thead>
            <tr>
              <th className="px-3 py-2">Block</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2" style={{ minWidth: '120px' }}>Gas Used</th>
              <th className="px-3 py-2 text-right" style={{ minWidth: '70px' }}>Base Fee</th>
              <th className="px-3 py-2 text-right" style={{ minWidth: '75px' }}>Min Priority</th>
              <th className="px-3 py-2 text-right" style={{ minWidth: '75px' }}>Median Priority</th>
              <th className="px-3 py-2 text-right" style={{ minWidth: '75px' }}>Max Priority</th>
              <th className="px-3 py-2 text-right" style={{ minWidth: '75px' }} title="Total Base Fee (POL)">Base (POL)</th>
              <th className="px-3 py-2 text-right" style={{ minWidth: '75px' }} title="Total Priority Fee (POL)">Priority (POL)</th>
              <th className="px-3 py-2 text-right" style={{ minWidth: '70px' }}>Txs</th>
              <th className="px-3 py-2 text-right" style={{ minWidth: '55px' }}>MGAS/s</th>
              <th className="px-3 py-2 text-right" style={{ minWidth: '40px' }}>TPS</th>
              <th className="px-3 py-2 text-right" style={{ minWidth: '60px' }}>Finality</th>
            </tr>
          </thead>
          <tbody>
            {blocks.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-muted">
                  No blocks found
                </td>
              </tr>
            ) : (
              blocks.map((block) => (
                <tr key={block.blockNumber} className="hover:bg-surface-hover transition-colors">
                  <td className="px-3 py-2">
                    <Link
                      href={`/blocks/${block.blockNumber}`}
                      className="text-accent hover:text-accent-secondary hover:underline font-mono transition-colors"
                    >
                      {block.blockNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted" title={new Date(block.timestamp).toLocaleString()}>
                    {getTimeAgo(new Date(block.timestamp))}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <div className="relative w-full bg-surface-elevated rounded-full h-4 overflow-hidden">
                        <div
                          className={`h-4 rounded-full ${getGasUtilizationColor(block.gasUsedPercent)}`}
                          style={{ width: `${Math.min(block.gasUsedPercent, 100)}%` }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-foreground">
                          {block.gasUsedPercent.toFixed(2)}%
                        </span>
                      </div>
                      <div className="flex justify-between text-xs text-muted">
                        <span className="font-mono">{formatGas(block.gasUsed)}</span>
                        <span className="font-mono">/ {formatGas(block.gasLimit)}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-foreground">{block.baseFeeGwei.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">
                    {block.avgPriorityFeeGwei !== null ? block.minPriorityFeeGwei.toFixed(2) : <span className="text-muted italic">calculating</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {block.avgPriorityFeeGwei !== null ? block.medianPriorityFeeGwei.toFixed(2) : <span className="text-muted italic">calculating</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {block.avgPriorityFeeGwei !== null ? block.maxPriorityFeeGwei.toFixed(2) : <span className="text-muted italic">calculating</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{formatGweiToPol(block.totalBaseFeeGwei)}</td>
                  <td className="px-3 py-2 text-right">
                    {block.totalPriorityFeeGwei !== null ? formatGweiToPol(block.totalPriorityFeeGwei) : <span className="text-muted italic">calculating</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {block.avgPriorityFeeGwei !== null ? block.txCount : <span className="text-muted italic">calculating</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{block.mgasPerSec?.toFixed(1) ?? '-'}</td>
                  <td className="px-3 py-2 text-right">{block.tps?.toFixed(0) ?? '-'}</td>
                  <td className="px-3 py-2 text-right">
                    {block.finalized ? (
                      <span className="text-success font-medium">
                        {block.timeToFinalitySec !== null ? `${Math.round(block.timeToFinalitySec)}s` : '-'}
                      </span>
                    ) : (
                      <span className="text-warning">pending</span>
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
