'use client';

import dynamic from 'next/dynamic';

function MiniChartSkeleton() {
  return (
    <div className="terminal-card rounded-lg p-4 relative overflow-hidden animate-pulse">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent/30 rounded-t-lg" />
      <div className="flex justify-between items-start mb-2 pt-1">
        <div className="h-4 w-20 bg-surface-elevated rounded" />
        <div className="h-6 w-16 bg-surface-elevated rounded" />
      </div>
      <div className="h-[180px] bg-surface-elevated/50 rounded" />
    </div>
  );
}

export const LazyMiniChart = dynamic(
  () => import('./MiniChart').then((mod) => mod.MiniChart),
  { loading: () => <MiniChartSkeleton />, ssr: false }
);
