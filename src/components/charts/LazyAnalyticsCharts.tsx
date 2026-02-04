'use client';

import dynamic from 'next/dynamic';

function ChartSkeleton() {
  return (
    <div className="terminal-card rounded-lg p-4 relative overflow-hidden animate-pulse">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent/30 rounded-t-lg" />
      <div className="h-5 w-40 bg-surface-elevated rounded mb-4" />
      <div className="h-10 bg-surface-elevated/30 rounded mb-4" />
      <div className="h-[300px] bg-surface-elevated/50 rounded" />
    </div>
  );
}

export const LazySharedFullChart = dynamic(
  () => import('./SharedFullChart').then((mod) => mod.SharedFullChart),
  { loading: () => <ChartSkeleton />, ssr: false }
);

export const LazySharedCustomizableChart = dynamic(
  () => import('./SharedCustomizableChart').then((mod) => mod.SharedCustomizableChart),
  { loading: () => <ChartSkeleton />, ssr: false }
);

export const LazyInflationChart = dynamic(
  () => import('./InflationChart').then((mod) => mod.InflationChart),
  { loading: () => <ChartSkeleton />, ssr: false }
);
