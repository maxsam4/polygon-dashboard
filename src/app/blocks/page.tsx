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

export default function BlocksPage() {
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [jumpToBlock, setJumpToBlock] = useState('');
  const [page, setPage] = useState(1);

  const fetchBlocks = useCallback(async (pageNum: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/blocks?page=${pageNum}&limit=50`);
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
    fetchBlocks(page);
  }, [page, fetchBlocks]);

  const handleJumpToBlock = async () => {
    if (!jumpToBlock) return;
    const blockNum = parseInt(jumpToBlock, 10);
    if (isNaN(blockNum)) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/blocks?fromBlock=${blockNum}&toBlock=${blockNum}&limit=1`);
      const data = await response.json();
      if (data.blocks?.length > 0) {
        const total = data.pagination?.total || 0;
        const pageNum = Math.ceil((total - blockNum + parseInt(data.blocks[0].blockNumber)) / 50);
        setPage(Math.max(1, pageNum));
      }
    } catch (error) {
      console.error('Failed to jump to block:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <Nav />

      <main className="w-full px-4 py-6">
        <div className="flex gap-4 mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              value={jumpToBlock}
              onChange={(e) => setJumpToBlock(e.target.value)}
              placeholder="Block number"
              className="px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700"
            />
            <button
              onClick={handleJumpToBlock}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Go
            </button>
          </div>
          <button className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">
            Export CSV
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : (
          <>
            <BlockTable blocks={blocks} title="Historic Blocks" />

            {pagination && (
              <div className="flex justify-center items-center gap-4 mt-6">
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
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
