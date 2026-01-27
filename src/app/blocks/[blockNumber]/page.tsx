'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { TransactionDetails } from '@/lib/types';
import { EXTERNAL_URLS } from '@/lib/constants';

interface BlockDetails {
  blockNumber: string;
  timestamp: string;
  blockHash: string;
  parentHash: string;
  gasUsed: string;
  gasLimit: string;
  gasUsedPercent: number;
  baseFeeGwei: number;
  avgPriorityFeeGwei: number;
  medianPriorityFeeGwei: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  totalBaseFeeGwei: number;
  totalPriorityFeeGwei: number;
  txCount: number;
  blockTimeSec: number | null;
  mgasPerSec: number | null;
  tps: number | null;
  finalized: boolean;
  finalizedAt: string | null;
  timeToFinalitySec: number | null;
  milestoneId: string | null;
}

interface BlockDetailsResponse {
  block: BlockDetails;
  transactions: TransactionDetails[];
}

function formatNumber(num: number | string): string {
  return Number(num).toLocaleString();
}

function truncateHash(hash: string, chars = 8): string {
  if (hash.length <= chars * 2 + 2) return hash;
  return `${hash.slice(0, chars + 2)}...${hash.slice(-chars)}`;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}

function getTimeAgo(isoString: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">{title}</h2>
      {children}
    </div>
  );
}

function InfoRow({ label, value, copyable = false }: { label: string; value: React.ReactNode; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof value === 'string') {
      navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-wrap justify-between py-2 border-b border-gray-200 dark:border-gray-700 last:border-0">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-gray-900 dark:text-gray-100 font-mono text-sm flex items-center gap-2">
        {value}
        {copyable && typeof value === 'string' && (
          <button
            onClick={handleCopy}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            title="Copy to clipboard"
          >
            {copied ? '✓' : '⧉'}
          </button>
        )}
      </span>
    </div>
  );
}

export default function BlockDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const blockNumber = params.blockNumber as string;

  const [data, setData] = useState<BlockDetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!blockNumber) return;

    setLoading(true);
    setError(null);

    fetch(`/api/blocks/${blockNumber}`)
      .then(r => {
        if (!r.ok) throw new Error('Block not found');
        return r.json();
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [blockNumber]);

  const navigateToBlock = (offset: number) => {
    const newBlockNum = BigInt(blockNumber) + BigInt(offset);
    if (newBlockNum >= 0n) {
      router.push(`/blocks/${newBlockNum.toString()}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <Nav />
        <main className="w-full px-4 py-6">
          <div className="text-center py-8">Loading block details...</div>
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen">
        <Nav />
        <main className="w-full px-4 py-6">
          <div className="text-center py-8 text-red-500">{error || 'Failed to load block'}</div>
          <div className="text-center">
            <Link href="/blocks" className="text-blue-500 hover:underline">
              Back to Blocks
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const { block, transactions } = data;
  const totalFeePOL = (block.totalBaseFeeGwei + block.totalPriorityFeeGwei) / 1e9;

  return (
    <div className="min-h-screen">
      <Nav />

      <main className="w-full px-4 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between mb-6 gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/blocks"
              className="text-blue-500 hover:text-blue-600 flex items-center gap-1"
            >
              ← Blocks
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Block #{formatNumber(block.blockNumber)}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateToBlock(-1)}
              className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              ← Prev
            </button>
            <button
              onClick={() => navigateToBlock(1)}
              className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              Next →
            </button>
            <a
              href={`${EXTERNAL_URLS.POLYGONSCAN_BLOCK}${block.blockNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              View on Polygonscan ↗
            </a>
          </div>
        </div>

        {/* Timestamp info */}
        <div className="text-gray-500 dark:text-gray-400 mb-6">
          {formatTimestamp(block.timestamp)} ({getTimeAgo(block.timestamp)})
        </div>

        {/* Cards grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Block Information */}
          <Card title="Block Information">
            <InfoRow label="Block Hash" value={block.blockHash} copyable />
            <InfoRow label="Parent Hash" value={block.parentHash} copyable />
            <InfoRow
              label="Gas Used"
              value={`${formatNumber(block.gasUsed)} (${block.gasUsedPercent.toFixed(1)}%)`}
            />
            <InfoRow label="Gas Limit" value={formatNumber(block.gasLimit)} />
            <InfoRow label="Base Fee" value={`${block.baseFeeGwei.toFixed(2)} Gwei`} />
            <InfoRow
              label="Finality"
              value={
                block.finalized ? (
                  <span className="text-green-500">
                    Finalized ({block.timeToFinalitySec?.toFixed(1)}s)
                  </span>
                ) : (
                  <span className="text-yellow-500">Pending</span>
                )
              }
            />
            {block.milestoneId && (
              <InfoRow label="Milestone ID" value={block.milestoneId} />
            )}
          </Card>

          {/* Metrics */}
          <Card title="Metrics">
            <InfoRow label="Transactions" value={formatNumber(block.txCount)} />
            <InfoRow
              label="Block Time"
              value={block.blockTimeSec ? `${block.blockTimeSec.toFixed(1)}s` : 'N/A'}
            />
            <InfoRow
              label="MGAS/s"
              value={block.mgasPerSec?.toFixed(2) ?? 'N/A'}
            />
            <InfoRow label="TPS" value={block.tps?.toFixed(1) ?? 'N/A'} />
            <InfoRow
              label="Total Base Fee"
              value={`${(block.totalBaseFeeGwei / 1e9).toFixed(4)} POL`}
            />
            <InfoRow
              label="Total Priority Fee"
              value={`${(block.totalPriorityFeeGwei / 1e9).toFixed(4)} POL`}
            />
            <InfoRow
              label="Total Fees"
              value={`${totalFeePOL.toFixed(4)} POL`}
            />
          </Card>
        </div>

        {/* Fee Details */}
        <Card title="Priority Fee Details">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 bg-gray-100 dark:bg-gray-800 rounded">
              <div className="text-sm text-gray-500 dark:text-gray-400">Min</div>
              <div className="font-mono">{block.minPriorityFeeGwei.toFixed(2)} Gwei</div>
            </div>
            <div className="text-center p-3 bg-gray-100 dark:bg-gray-800 rounded">
              <div className="text-sm text-gray-500 dark:text-gray-400">Avg</div>
              <div className="font-mono">{block.avgPriorityFeeGwei.toFixed(2)} Gwei</div>
            </div>
            <div className="text-center p-3 bg-gray-100 dark:bg-gray-800 rounded">
              <div className="text-sm text-gray-500 dark:text-gray-400">Median</div>
              <div className="font-mono">{block.medianPriorityFeeGwei.toFixed(2)} Gwei</div>
            </div>
            <div className="text-center p-3 bg-gray-100 dark:bg-gray-800 rounded">
              <div className="text-sm text-gray-500 dark:text-gray-400">Max</div>
              <div className="font-mono">{block.maxPriorityFeeGwei.toFixed(2)} Gwei</div>
            </div>
          </div>
        </Card>

        {/* Transactions Table */}
        <div className="mt-6">
          <Card title={`Transactions (${transactions.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Hash</th>
                    <th className="px-3 py-2">From</th>
                    <th className="px-3 py-2">To</th>
                    <th className="px-3 py-2 text-right">Value</th>
                    <th className="px-3 py-2 text-right">Gas Used</th>
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                        No transactions in this block
                      </td>
                    </tr>
                  ) : (
                    transactions.map((tx, idx) => (
                      <tr
                        key={tx.hash}
                        className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      >
                        <td className="px-3 py-2 text-gray-500">{tx.transactionIndex ?? idx}</td>
                        <td className="px-3 py-2 font-mono">
                          <a
                            href={`${EXTERNAL_URLS.POLYGONSCAN_TX}${tx.hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline"
                          >
                            {truncateHash(tx.hash)}
                          </a>
                        </td>
                        <td className="px-3 py-2 font-mono">
                          <a
                            href={`${EXTERNAL_URLS.POLYGONSCAN_ADDRESS}${tx.from}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline"
                          >
                            {truncateAddress(tx.from)}
                          </a>
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {tx.to ? (
                            <a
                              href={`${EXTERNAL_URLS.POLYGONSCAN_ADDRESS}${tx.to}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-500 hover:underline"
                            >
                              {truncateAddress(tx.to)}
                            </a>
                          ) : (
                            <span className="text-purple-500">Contract Creation</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {parseFloat(tx.value).toFixed(4)} POL
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {tx.gasUsed ? formatNumber(tx.gasUsed) : 'N/A'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {tx.status === 'success' ? (
                            <span className="text-green-500" title="Success">✓</span>
                          ) : tx.status === 'reverted' ? (
                            <span className="text-red-500" title="Reverted">✗</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
