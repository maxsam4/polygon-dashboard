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
  avgPriorityFeeGwei: number | null;  // null = pending (receipt data not yet fetched)
  medianPriorityFeeGwei: number;
  minPriorityFeeGwei: number;
  maxPriorityFeeGwei: number;
  totalBaseFeeGwei: number;
  totalPriorityFeeGwei: number | null;  // null = pending (receipt data not yet fetched)
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
    <div className="glass-card-solid rounded-xl p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 gradient-polygon" />
      <h2 className="text-lg font-semibold mb-4 text-foreground pt-1">{title}</h2>
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
    <div className="flex flex-wrap justify-between py-2 border-b border-accent/10 dark:border-accent/20 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-foreground font-mono text-sm flex items-center gap-2">
        {value}
        {copyable && typeof value === 'string' && (
          <button
            onClick={handleCopy}
            className="text-muted/70 hover:text-accent"
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
      <div className="min-h-screen bg-background">
        <Nav />
        <main className="w-full px-4 py-6">
          <div className="text-center py-8 text-muted">Loading block details...</div>
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background">
        <Nav />
        <main className="w-full px-4 py-6">
          <div className="text-center py-8 text-danger">{error || 'Failed to load block'}</div>
          <div className="text-center">
            <Link href="/blocks" className="text-accent hover:underline">
              Back to Blocks
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const { block, transactions } = data;
  const totalFeePOL = block.totalPriorityFeeGwei !== null
    ? (block.totalBaseFeeGwei + block.totalPriorityFeeGwei) / 1e9
    : null;

  return (
    <div className="min-h-screen bg-background">
      <Nav />

      <main className="w-full px-4 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between mb-6 gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/blocks"
              className="text-accent hover:text-accent-secondary flex items-center gap-1"
            >
              ← Blocks
            </Link>
            <h1 className="text-2xl font-bold text-foreground">
              Block #{formatNumber(block.blockNumber)}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateToBlock(-1)}
              className="px-3 py-1 btn-surface rounded-lg"
            >
              ← Prev
            </button>
            <button
              onClick={() => navigateToBlock(1)}
              className="px-3 py-1 btn-surface rounded-lg"
            >
              Next →
            </button>
            <a
              href={`${EXTERNAL_URLS.POLYGONSCAN_BLOCK}${block.blockNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 btn-gradient-active rounded-lg"
            >
              View on Polygonscan ↗
            </a>
          </div>
        </div>

        {/* Timestamp info */}
        <div className="text-muted mb-6">
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
              value={block.totalPriorityFeeGwei !== null
                ? `${(block.totalPriorityFeeGwei / 1e9).toFixed(4)} POL`
                : '...'}
            />
            <InfoRow
              label="Total Fees"
              value={totalFeePOL !== null ? `${totalFeePOL.toFixed(4)} POL` : '...'}
            />
          </Card>
        </div>

        {/* Fee Details */}
        <Card title="Priority Fee Details">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 bg-surface dark:bg-surface-elevated rounded-lg border border-accent/10">
              <div className="text-sm text-muted">Min</div>
              <div className="font-mono text-foreground">{block.minPriorityFeeGwei.toFixed(2)} Gwei</div>
            </div>
            <div className="text-center p-3 bg-surface dark:bg-surface-elevated rounded-lg border border-accent/10">
              <div className="text-sm text-muted">Avg</div>
              <div className="font-mono text-foreground">
                {block.avgPriorityFeeGwei !== null ? `${block.avgPriorityFeeGwei.toFixed(2)} Gwei` : '...'}
              </div>
            </div>
            <div className="text-center p-3 bg-surface dark:bg-surface-elevated rounded-lg border border-accent/10">
              <div className="text-sm text-muted">Median</div>
              <div className="font-mono text-foreground">{block.medianPriorityFeeGwei.toFixed(2)} Gwei</div>
            </div>
            <div className="text-center p-3 bg-surface dark:bg-surface-elevated rounded-lg border border-accent/10">
              <div className="text-sm text-muted">Max</div>
              <div className="font-mono text-foreground">{block.maxPriorityFeeGwei.toFixed(2)} Gwei</div>
            </div>
          </div>
        </Card>

        {/* Transactions Table */}
        <div className="mt-6">
          <Card title={`Transactions (${transactions.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-accent/10 dark:border-accent/20 text-left text-muted">
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Hash</th>
                    <th className="px-3 py-2 font-medium">From</th>
                    <th className="px-3 py-2 font-medium">To</th>
                    <th className="px-3 py-2 text-right font-medium">Value</th>
                    <th className="px-3 py-2 text-right font-medium">Gas Used</th>
                    <th className="px-3 py-2 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-muted">
                        No transactions in this block
                      </td>
                    </tr>
                  ) : (
                    transactions.map((tx, idx) => (
                      <tr
                        key={tx.hash}
                        className="border-b border-accent/10 last:border-0 hover:bg-surface-hover transition-colors"
                      >
                        <td className="px-3 py-2 text-muted">{tx.transactionIndex ?? idx}</td>
                        <td className="px-3 py-2 font-mono">
                          <a
                            href={`${EXTERNAL_URLS.POLYGONSCAN_TX}${tx.hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:text-accent-secondary"
                          >
                            {truncateHash(tx.hash)}
                          </a>
                        </td>
                        <td className="px-3 py-2 font-mono">
                          <a
                            href={`${EXTERNAL_URLS.POLYGONSCAN_ADDRESS}${tx.from}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:text-accent-secondary"
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
                              className="text-accent hover:text-accent-secondary"
                            >
                              {truncateAddress(tx.to)}
                            </a>
                          ) : (
                            <span className="text-accent-secondary">Contract Creation</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-foreground">
                          {parseFloat(tx.value).toFixed(4)} POL
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-foreground">
                          {tx.gasUsed ? formatNumber(tx.gasUsed) : 'N/A'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {tx.status === 'success' ? (
                            <span className="text-success" title="Success">✓</span>
                          ) : tx.status === 'reverted' ? (
                            <span className="text-danger" title="Reverted">✗</span>
                          ) : (
                            <span className="text-muted">-</span>
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
