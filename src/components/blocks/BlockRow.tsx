'use client';

import { useState } from 'react';

interface BlockData {
  blockNumber: string;
  timestamp: string;
  gasUsedPercent: number;
  baseFeeGwei: number;
  avgPriorityFeeGwei: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  txCount: number;
  gasUsed: string;
  gasLimit: string;
  totalBaseFeeGwei?: number;
  totalPriorityFeeGwei?: number;
  finalized: boolean;
  timeToFinalitySec: number | null;
}

interface BlockRowProps {
  block: BlockData;
}

export function BlockRow({ block }: BlockRowProps) {
  const [expanded, setExpanded] = useState(false);

  const timeAgo = getTimeAgo(new Date(block.timestamp));
  const polygonscanUrl = `https://polygonscan.com/block/${block.blockNumber}`;

  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
      <div
        className="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-4 flex-1">
          <a
            href={polygonscanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline font-mono text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            #{block.blockNumber}
          </a>
          <span className="text-gray-500 text-sm">{timeAgo}</span>
          <span className="text-sm">{block.gasUsedPercent.toFixed(1)}%</span>
          <span className="text-sm font-medium">{block.baseFeeGwei.toFixed(2)} gwei</span>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            +{block.avgPriorityFeeGwei.toFixed(2)}
          </span>
          <span className="text-sm">{block.txCount} txs</span>
          {block.finalized ? (
            <span className="text-green-500 text-sm">
              {block.timeToFinalitySec?.toFixed(1)}s
            </span>
          ) : (
            <span className="text-yellow-500 text-sm">pending</span>
          )}
        </div>
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {expanded && (
        <div className="p-3 bg-gray-50 dark:bg-gray-800 text-sm grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <span className="text-gray-500">Min Priority:</span>{' '}
            {block.minPriorityFeeGwei.toFixed(4)} gwei
          </div>
          <div>
            <span className="text-gray-500">Max Priority:</span>{' '}
            {block.maxPriorityFeeGwei.toFixed(4)} gwei
          </div>
          <div>
            <span className="text-gray-500">Gas Used:</span>{' '}
            {formatNumber(parseInt(block.gasUsed, 10))}
          </div>
          <div>
            <span className="text-gray-500">Gas Limit:</span>{' '}
            {formatNumber(parseInt(block.gasLimit, 10))}
          </div>
          {block.totalBaseFeeGwei !== undefined && (
            <div>
              <span className="text-gray-500">Total Base Fee:</span>{' '}
              {block.totalBaseFeeGwei.toFixed(4)} gwei
            </div>
          )}
          {block.totalPriorityFeeGwei !== undefined && (
            <div>
              <span className="text-gray-500">Total Priority Fee:</span>{' '}
              {block.totalPriorityFeeGwei.toFixed(4)} gwei
            </div>
          )}
          <div className="col-span-2 md:col-span-4">
            <a
              href={polygonscanUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              View on Polygonscan
            </a>
          </div>
        </div>
      )}
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

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toString();
}
