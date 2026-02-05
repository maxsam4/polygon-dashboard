'use client';

import { Nav } from '@/components/Nav';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface AnomalyData {
  id: number;
  timestamp: string;
  metricType: string;
  severity: 'warning' | 'critical';
  value: number | null;
  expectedValue: number | null;
  threshold: number | null;
  startBlockNumber: string | null;
  endBlockNumber: string | null;
  createdAt: string;
}

interface AnomalyStats {
  total: number;
  critical: number;
  warning: number;
}

const METRIC_LABELS: Record<string, string> = {
  gas_price: 'Gas Price',
  block_time: 'Block Time',
  finality: 'Finality',
  tps: 'TPS',
  mgas: 'MGAS/s',
  reorg: 'Reorg',
};

const METRIC_UNITS: Record<string, string> = {
  gas_price: 'Gwei',
  block_time: 's',
  finality: 's',
  tps: 'tx/s',
  mgas: 'MGAS/s',
  reorg: '',
};

const TIME_RANGES = [
  { label: '1H', value: 1 },
  { label: '6H', value: 6 },
  { label: '24H', value: 24 },
  { label: '7D', value: 168 },
  { label: '30D', value: 720 },
];

function formatTimeAgo(isoString: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatValue(value: number | null, metricType: string): string {
  if (value === null) return '-';
  const unit = METRIC_UNITS[metricType] || '';
  return `${value.toFixed(2)}${unit ? ' ' + unit : ''}`;
}

function StatCard({ label, value, subLabel, variant }: { label: string; value: number | string; subLabel?: string; variant?: 'critical' | 'warning' }) {
  const variantStyles = {
    critical: 'border-l-4 border-l-danger',
    warning: 'border-l-4 border-l-warning',
  };

  return (
    <div className={`glass-card-solid rounded-xl p-4 relative overflow-hidden ${variant ? variantStyles[variant] : ''}`}>
      <div className="absolute top-0 left-0 right-0 h-0.5 gradient-polygon" />
      <div className="text-muted text-sm pt-1">{label}</div>
      <div className={`text-2xl font-bold ${variant === 'critical' ? 'text-danger' : variant === 'warning' ? 'text-warning' : 'text-foreground'}`}>
        {value}
      </div>
      {subLabel && <div className="text-muted/70 text-xs">{subLabel}</div>}
    </div>
  );
}

export default function AlertsPage() {
  const [anomalies, setAnomalies] = useState<AnomalyData[]>([]);
  const [stats, setStats] = useState<AnomalyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRangeHours, setTimeRangeHours] = useState(24);
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(new Set());
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  const fetchAnomalies = useCallback(async () => {
    try {
      const from = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000);
      let url = `/api/anomalies?from=${from.toISOString()}&limit=${limit}&offset=${(page - 1) * limit}`;

      if (selectedSeverity !== 'all') {
        url += `&severity=${selectedSeverity}`;
      }

      // Note: metric filtering is done client-side for multiple metrics
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch anomalies');
      const data = await res.json();

      // Filter by selected metrics client-side
      let filtered = data.anomalies;
      if (selectedMetrics.size > 0) {
        filtered = filtered.filter((a: AnomalyData) => selectedMetrics.has(a.metricType));
      }

      setAnomalies(filtered);
      setTotal(selectedMetrics.size > 0 ? filtered.length : data.total);
      setStats(data.stats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [timeRangeHours, selectedSeverity, selectedMetrics, page]);

  useEffect(() => {
    setLoading(true);
    fetchAnomalies();
    const interval = setInterval(fetchAnomalies, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [fetchAnomalies]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [timeRangeHours, selectedSeverity, selectedMetrics]);

  const toggleMetric = (metric: string) => {
    setSelectedMetrics(prev => {
      const next = new Set(prev);
      if (next.has(metric)) {
        next.delete(metric);
      } else {
        next.add(metric);
      }
      return next;
    });
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="min-h-screen bg-background">
      <Nav />

      <main className="w-full px-4 py-6 max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground mb-6">Alerts</h1>

        {loading && !stats && (
          <div className="text-muted">Loading...</div>
        )}

        {error && (
          <div className="bg-danger/20 text-danger p-4 rounded-lg mb-4">
            Error: {error}
          </div>
        )}

        {stats && (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <StatCard
                label="Total Alerts"
                value={stats.total}
                subLabel={`Last ${timeRangeHours}h`}
              />
              <StatCard
                label="Critical"
                value={stats.critical}
                variant="critical"
              />
              <StatCard
                label="Warnings"
                value={stats.warning}
                variant="warning"
              />
            </div>

            {/* Filters */}
            <div className="glass-card-solid rounded-xl p-4 mb-6 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-0.5 gradient-polygon" />
              <div className="flex flex-wrap gap-4 items-center pt-1">
                {/* Time Range */}
                <div className="flex items-center gap-2">
                  <span className="text-muted text-sm">Time Range:</span>
                  <div className="flex gap-1">
                    {TIME_RANGES.map(({ label, value }) => (
                      <button
                        key={value}
                        onClick={() => setTimeRangeHours(value)}
                        className={`px-3 py-1.5 text-xs rounded transition-all ${
                          timeRangeHours === value
                            ? 'btn-gradient-active'
                            : 'terminal-btn hover:bg-surface-hover'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Severity Filter */}
                <div className="flex items-center gap-2">
                  <span className="text-muted text-sm">Severity:</span>
                  <select
                    value={selectedSeverity}
                    onChange={(e) => setSelectedSeverity(e.target.value)}
                    className="bg-background border border-accent/20 rounded px-2 py-1 text-sm text-foreground"
                  >
                    <option value="all">All</option>
                    <option value="critical">Critical</option>
                    <option value="warning">Warning</option>
                  </select>
                </div>

                {/* Metric Filters */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-muted text-sm">Metrics:</span>
                  {Object.entries(METRIC_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => toggleMetric(key)}
                      className={`px-2 py-1 text-xs rounded transition-all ${
                        selectedMetrics.has(key)
                          ? 'btn-gradient-active'
                          : selectedMetrics.size === 0
                            ? 'terminal-btn opacity-70 hover:opacity-100'
                            : 'terminal-btn opacity-50 hover:opacity-100'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Alerts Table */}
            <div className="glass-card-solid rounded-xl overflow-hidden relative">
              <div className="absolute top-0 left-0 right-0 h-0.5 gradient-polygon" />
              <div className="px-4 py-3 border-b border-accent/10 dark:border-accent/20">
                <h2 className="text-lg font-semibold text-foreground">Recent Alerts</h2>
              </div>

              {anomalies.length === 0 ? (
                <div className="px-4 py-8 text-center text-muted">
                  No alerts detected in the selected time range
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-muted text-sm border-b border-accent/10 dark:border-accent/15">
                        <th className="px-4 py-3 text-left font-medium">Time</th>
                        <th className="px-4 py-3 text-left font-medium">Metric</th>
                        <th className="px-4 py-3 text-left font-medium">Value</th>
                        <th className="px-4 py-3 text-left font-medium">Threshold</th>
                        <th className="px-4 py-3 text-left font-medium">Severity</th>
                        <th className="px-4 py-3 text-left font-medium">Blocks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {anomalies.map((anomaly) => (
                        <tr key={anomaly.id} className="border-b border-accent/10 last:border-0 hover:bg-surface-hover transition-colors">
                          <td className="px-4 py-3 text-muted">
                            <span title={new Date(anomaly.timestamp).toLocaleString()}>
                              {formatTimeAgo(anomaly.timestamp)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-foreground">
                            {METRIC_LABELS[anomaly.metricType] || anomaly.metricType}
                          </td>
                          <td className="px-4 py-3 font-mono">
                            <span className={anomaly.severity === 'critical' ? 'text-danger' : 'text-warning'}>
                              {formatValue(anomaly.value, anomaly.metricType)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted font-mono">
                            {formatValue(anomaly.threshold, anomaly.metricType)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium ${
                                anomaly.severity === 'critical'
                                  ? 'bg-danger/20 text-danger'
                                  : 'bg-warning/20 text-warning'
                              }`}
                            >
                              {anomaly.severity}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono">
                            {anomaly.startBlockNumber ? (
                              anomaly.startBlockNumber === anomaly.endBlockNumber ? (
                                <Link
                                  href={`/blocks?block=${anomaly.startBlockNumber}`}
                                  className="text-accent hover:underline"
                                >
                                  #{anomaly.startBlockNumber}
                                </Link>
                              ) : (
                                <span>
                                  <Link
                                    href={`/blocks?block=${anomaly.startBlockNumber}`}
                                    className="text-accent hover:underline"
                                  >
                                    #{anomaly.startBlockNumber}
                                  </Link>
                                  <span className="text-muted"> - </span>
                                  <Link
                                    href={`/blocks?block=${anomaly.endBlockNumber}`}
                                    className="text-accent hover:underline"
                                  >
                                    #{anomaly.endBlockNumber}
                                  </Link>
                                </span>
                              )
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-accent/10 flex justify-between items-center">
                  <span className="text-muted text-sm">
                    Showing {(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-3 py-1 text-sm terminal-btn rounded disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="px-3 py-1 text-sm terminal-btn rounded disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Info Box */}
            <div className="mt-6 glass-card-solid rounded-xl p-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-0.5 gradient-polygon" />
              <h3 className="text-foreground font-semibold mb-2 pt-1">About Anomaly Detection</h3>
              <p className="text-muted text-sm">
                Anomalies are detected when metrics exceed calibrated thresholds based on historical data.
                Warning thresholds indicate unusual activity, while critical thresholds indicate severe deviations
                that may require immediate attention. Reorgs are always marked as critical alerts.
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
