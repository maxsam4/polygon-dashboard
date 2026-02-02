'use client';

import { useEffect, useState, useCallback } from 'react';
import { Nav } from '@/components/Nav';
import { MilestoneTable } from '@/components/milestones/MilestoneTable';

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

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const MILESTONES_PER_PAGE_OPTIONS = [25, 50, 100];

export default function MilestonesPage() {
  const [milestones, setMilestones] = useState<MilestoneData[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [milestonesPerPage, setMilestonesPerPage] = useState(50);
  const [goToPage, setGoToPage] = useState('');

  const fetchMilestones = useCallback(async (pageNum: number, limit: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/milestones?page=${pageNum}&limit=${limit}`);
      const data = await response.json();
      setMilestones(data.milestones || []);
      setPagination(data.pagination);
    } catch (error) {
      console.error('Failed to fetch milestones:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMilestones(page, milestonesPerPage);
  }, [page, milestonesPerPage, fetchMilestones]);

  const handleGoToPage = () => {
    const targetPage = parseInt(goToPage, 10);
    if (!isNaN(targetPage) && targetPage >= 1 && pagination && targetPage <= pagination.totalPages) {
      setPage(targetPage);
      setGoToPage('');
    }
  };

  const handleMilestonesPerPageChange = (newLimit: number) => {
    setMilestonesPerPage(newLimit);
    setPage(1);
  };

  // Calculate summary stats
  const totalBlocksExpected = milestones.reduce((sum, m) => sum + m.blockCount, 0);
  const totalBlocksInDb = milestones.reduce((sum, m) => sum + m.blocksInDb, 0);
  const overallCoverage = totalBlocksExpected > 0 ? (totalBlocksInDb / totalBlocksExpected) * 100 : 0;

  return (
    <div className="min-h-screen bg-background">
      <Nav />

      <main className="w-full px-4 py-6">
        {/* Summary stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="glass-card-solid rounded-xl p-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent" />
            <div className="text-sm text-muted pt-1">Total Milestones</div>
            <div className="text-2xl font-bold text-foreground">{pagination?.total.toLocaleString() ?? '-'}</div>
          </div>
          <div className="glass-card-solid rounded-xl p-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent-secondary" />
            <div className="text-sm text-muted pt-1">Blocks Expected (page)</div>
            <div className="text-2xl font-bold text-foreground">{totalBlocksExpected.toLocaleString()}</div>
          </div>
          <div className="glass-card-solid rounded-xl p-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent" />
            <div className="text-sm text-muted pt-1">Blocks In DB (page)</div>
            <div className="text-2xl font-bold text-foreground">{totalBlocksInDb.toLocaleString()}</div>
          </div>
          <div className="glass-card-solid rounded-xl p-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 gradient-polygon" />
            <div className="text-sm text-muted pt-1">Coverage (page)</div>
            <div className={`text-2xl font-bold ${overallCoverage === 100 ? 'text-success' : 'text-warning'}`}>
              {overallCoverage.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-4 mb-6 items-center">
          <div className="flex gap-2 items-center">
            <span className="text-sm text-muted">Per page:</span>
            <select
              value={milestonesPerPage}
              onChange={(e) => handleMilestonesPerPageChange(parseInt(e.target.value, 10))}
              className="px-3 py-2 rounded-lg bg-surface dark:bg-surface-elevated border border-accent/20 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              {MILESTONES_PER_PAGE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-muted">Loading...</div>
        ) : (
          <>
            <MilestoneTable milestones={milestones} />

            {pagination && (
              <div className="flex flex-wrap justify-center items-center gap-4 mt-6">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="px-3 py-2 btn-surface rounded-lg disabled:opacity-50"
                >
                  First
                </button>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 btn-surface rounded-lg disabled:opacity-50"
                >
                  Prev
                </button>
                <span className="text-foreground">
                  Page {pagination.page} of {pagination.totalPages.toLocaleString()}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={page === pagination.totalPages}
                  className="px-4 py-2 btn-surface rounded-lg disabled:opacity-50"
                >
                  Next
                </button>
                <button
                  onClick={() => setPage(pagination.totalPages)}
                  disabled={page === pagination.totalPages}
                  className="px-3 py-2 btn-surface rounded-lg disabled:opacity-50"
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
                    className="px-3 py-2 rounded-lg bg-surface dark:bg-surface-elevated border border-accent/20 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 w-20"
                  />
                  <button
                    onClick={handleGoToPage}
                    className="px-3 py-2 btn-gradient-active rounded-lg"
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
