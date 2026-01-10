'use client';

import { useEffect, useState, useCallback } from 'react';
import { Nav } from '@/components/Nav';
import { BlockTable } from '@/components/blocks/BlockTable';

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
  totalBaseFeeGwei: number;
  totalPriorityFeeGwei: number;
  finalized: boolean;
  timeToFinalitySec: number | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const BLOCKS_PER_PAGE_OPTIONS = [25, 50, 100, 200];

export default function BlocksPage() {
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [jumpToBlock, setJumpToBlock] = useState('');
  const [goToPage, setGoToPage] = useState('');
  const [page, setPage] = useState(1);
  const [blocksPerPage, setBlocksPerPage] = useState(50);
  const [exportFromBlock, setExportFromBlock] = useState('');
  const [exportToBlock, setExportToBlock] = useState('');
  const [exporting, setExporting] = useState(false);

  const fetchBlocks = useCallback(async (pageNum: number, limit: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/blocks?page=${pageNum}&limit=${limit}`);
      const data = await response.json();
      setBlocks(data.blocks || []);
      setPagination(data.pagination);
    } catch (error) {
      console.error('Failed to fetch blocks:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBlocks(page, blocksPerPage);
  }, [page, blocksPerPage, fetchBlocks]);

  const handleGoToPage = () => {
    const targetPage = parseInt(goToPage, 10);
    if (!isNaN(targetPage) && targetPage >= 1 && pagination && targetPage <= pagination.totalPages) {
      setPage(targetPage);
      setGoToPage('');
    }
  };

  const handleBlocksPerPageChange = (newLimit: number) => {
    setBlocksPerPage(newLimit);
    setPage(1); // Reset to first page when changing limit
  };

  const handleJumpToBlock = async () => {
    if (!jumpToBlock) return;
    const blockNum = parseInt(jumpToBlock, 10);
    if (isNaN(blockNum)) return;

    setLoading(true);
    try {
      // Get the latest block to calculate position
      const response = await fetch(`/api/blocks?page=1&limit=1`);
      const data = await response.json();
      if (data.blocks?.length > 0 && data.pagination) {
        const latestBlock = parseInt(data.blocks[0].blockNumber, 10);
        const blocksFromTop = latestBlock - blockNum;
        if (blocksFromTop >= 0) {
          const targetPage = Math.floor(blocksFromTop / blocksPerPage) + 1;
          setPage(Math.min(targetPage, data.pagination.totalPages));
        }
      }
      setJumpToBlock('');
    } catch (error) {
      console.error('Failed to jump to block:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = async () => {
    const fromBlock = exportFromBlock ? parseInt(exportFromBlock, 10) : null;
    const toBlock = exportToBlock ? parseInt(exportToBlock, 10) : null;

    // If no range specified, export current page
    const blocksToExport = (fromBlock !== null || toBlock !== null) ? null : blocks;

    if (!blocksToExport && fromBlock === null && toBlock === null) {
      if (blocks.length === 0) return;
    }

    setExporting(true);

    try {
      let exportBlocks: BlockData[];
      let filename: string;

      if (fromBlock !== null || toBlock !== null) {
        // Fetch blocks in the specified range
        const params = new URLSearchParams();
        if (fromBlock !== null) params.set('fromBlock', fromBlock.toString());
        if (toBlock !== null) params.set('toBlock', toBlock.toString());
        params.set('limit', '10000'); // Max export limit

        const response = await fetch(`/api/blocks?${params.toString()}`);
        const data = await response.json();
        exportBlocks = data.blocks || [];
        filename = `polygon-blocks-${fromBlock ?? 'start'}-${toBlock ?? 'end'}.csv`;
      } else {
        exportBlocks = blocks;
        filename = `polygon-blocks-page-${page}.csv`;
      }

      if (exportBlocks.length === 0) {
        alert('No blocks found in the specified range');
        return;
      }

      const headers = [
        'Block Number', 'Timestamp', 'Gas Used %', 'Base Fee (Gwei)',
        'Median Priority Fee (Gwei)', 'Min Priority Fee (Gwei)', 'Max Priority Fee (Gwei)',
        'Tx Count', 'Gas Used', 'Gas Limit', 'Block Time (s)',
        'MGAS/s', 'TPS', 'Finalized', 'Time to Finality (s)'
      ];

      const rows = exportBlocks.map(b => [
        b.blockNumber,
        b.timestamp,
        b.gasUsedPercent.toFixed(2),
        b.baseFeeGwei.toFixed(4),
        b.medianPriorityFeeGwei.toFixed(4),
        b.minPriorityFeeGwei.toFixed(4),
        b.maxPriorityFeeGwei.toFixed(4),
        b.txCount,
        b.gasUsed,
        b.gasLimit,
        b.blockTimeSec ?? '',
        b.mgasPerSec?.toFixed(2) ?? '',
        b.tps?.toFixed(2) ?? '',
        b.finalized ? 'Yes' : 'No',
        b.timeToFinalitySec ?? ''
      ]);

      const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${cell}"`).join(','))
        .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen">
      <Nav />

      <main className="w-full px-4 py-6">
        <div className="flex flex-wrap gap-4 mb-6 items-center">
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={jumpToBlock}
              onChange={(e) => setJumpToBlock(e.target.value)}
              placeholder="Block number"
              className="px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700 w-32"
            />
            <button
              onClick={handleJumpToBlock}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Jump
            </button>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-sm text-gray-600 dark:text-gray-400">Blocks per page:</span>
            <select
              value={blocksPerPage}
              onChange={(e) => handleBlocksPerPageChange(parseInt(e.target.value, 10))}
              className="px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700"
            >
              {BLOCKS_PER_PAGE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 items-center border-l pl-4 ml-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">Export range:</span>
            <input
              type="text"
              value={exportFromBlock}
              onChange={(e) => setExportFromBlock(e.target.value)}
              placeholder="From block"
              className="px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700 w-28"
            />
            <span className="text-gray-500">-</span>
            <input
              type="text"
              value={exportToBlock}
              onChange={(e) => setExportToBlock(e.target.value)}
              placeholder="To block"
              className="px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700 w-28"
            />
            <button
              onClick={handleExportCSV}
              disabled={exporting || (blocks.length === 0 && !exportFromBlock && !exportToBlock)}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
            >
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : (
          <>
            <BlockTable blocks={blocks} title="Historic Blocks" />

            {pagination && (
              <div className="flex flex-wrap justify-center items-center gap-4 mt-6">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50"
                >
                  First
                </button>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50"
                >
                  Prev
                </button>
                <span>
                  Page {pagination.page} of {pagination.totalPages.toLocaleString()}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={page === pagination.totalPages}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50"
                >
                  Next
                </button>
                <button
                  onClick={() => setPage(pagination.totalPages)}
                  disabled={page === pagination.totalPages}
                  className="px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50"
                >
                  Last
                </button>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={goToPage}
                    onChange={(e) => setGoToPage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleGoToPage()}
                    placeholder="Page #"
                    className="px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700 w-20"
                  />
                  <button
                    onClick={handleGoToPage}
                    className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    Go
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
