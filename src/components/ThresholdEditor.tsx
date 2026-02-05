'use client';

import { useState, useEffect } from 'react';
import { ANOMALY_THRESHOLDS } from '@/lib/constants';

interface Threshold {
  metricType: string;
  warningLow: number | null;
  warningHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  useAbsolute: boolean;
  minConsecutiveBlocks: number;
}

interface MetricConfig {
  label: string;
  unit: string;
  description: string;
}

const METRIC_CONFIGS: Record<string, MetricConfig> = {
  gas_price: {
    label: 'Gas Price',
    unit: 'Gwei',
    description: 'Base fee in Gwei',
  },
  block_time: {
    label: 'Block Time',
    unit: 'seconds',
    description: 'Time between blocks',
  },
  finality: {
    label: 'Finality',
    unit: 'seconds',
    description: 'Time to finality',
  },
  tps: {
    label: 'TPS',
    unit: 'tx/s',
    description: 'Transactions per second',
  },
  mgas: {
    label: 'MGAS/s',
    unit: 'MGAS/s',
    description: 'Gas throughput',
  },
};

function ThresholdCard({
  threshold,
  onSave,
}: {
  threshold: Threshold;
  onSave: (updated: Threshold) => Promise<void>;
}) {
  const [values, setValues] = useState({
    warningLow: threshold.warningLow?.toString() ?? '',
    warningHigh: threshold.warningHigh?.toString() ?? '',
    criticalLow: threshold.criticalLow?.toString() ?? '',
    criticalHigh: threshold.criticalHigh?.toString() ?? '',
    minConsecutiveBlocks: threshold.minConsecutiveBlocks?.toString() ?? '1',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const config = METRIC_CONFIGS[threshold.metricType] || {
    label: threshold.metricType,
    unit: '',
    description: '',
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);

    try {
      await onSave({
        ...threshold,
        warningLow: values.warningLow ? parseFloat(values.warningLow) : null,
        warningHigh: values.warningHigh ? parseFloat(values.warningHigh) : null,
        criticalLow: values.criticalLow ? parseFloat(values.criticalLow) : null,
        criticalHigh: values.criticalHigh ? parseFloat(values.criticalHigh) : null,
        minConsecutiveBlocks: values.minConsecutiveBlocks ? parseInt(values.minConsecutiveBlocks, 10) : 1,
      });
      setMessage({ type: 'success', text: 'Saved' });
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges =
    (values.warningLow || null) !== (threshold.warningLow?.toString() || null) ||
    (values.warningHigh || null) !== (threshold.warningHigh?.toString() || null) ||
    (values.criticalLow || null) !== (threshold.criticalLow?.toString() || null) ||
    (values.criticalHigh || null) !== (threshold.criticalHigh?.toString() || null) ||
    (values.minConsecutiveBlocks || '1') !== (threshold.minConsecutiveBlocks?.toString() || '1');

  return (
    <div className="terminal-card rounded-lg p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent rounded-t-lg" />

      <div className="flex justify-between items-start mb-3 pt-1">
        <div>
          <h4 className="text-lg font-semibold text-foreground">{config.label}</h4>
          <p className="text-xs text-muted">{config.description}</p>
        </div>
        <span className="text-xs text-muted bg-surface-hover px-2 py-1 rounded">
          {config.unit}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-warning mb-1">Warning Low</label>
          <input
            type="number"
            step="any"
            value={values.warningLow}
            onChange={(e) => setValues({ ...values, warningLow: e.target.value })}
            placeholder="None"
            className="w-full px-2 py-1 text-sm bg-surface dark:bg-surface-elevated text-foreground rounded border border-accent/20 focus:outline-none focus:ring-1 focus:ring-warning/50"
          />
        </div>
        <div>
          <label className="block text-xs text-warning mb-1">Warning High</label>
          <input
            type="number"
            step="any"
            value={values.warningHigh}
            onChange={(e) => setValues({ ...values, warningHigh: e.target.value })}
            placeholder="None"
            className="w-full px-2 py-1 text-sm bg-surface dark:bg-surface-elevated text-foreground rounded border border-accent/20 focus:outline-none focus:ring-1 focus:ring-warning/50"
          />
        </div>
        <div>
          <label className="block text-xs text-danger mb-1">Critical Low</label>
          <input
            type="number"
            step="any"
            value={values.criticalLow}
            onChange={(e) => setValues({ ...values, criticalLow: e.target.value })}
            placeholder="None"
            className="w-full px-2 py-1 text-sm bg-surface dark:bg-surface-elevated text-foreground rounded border border-accent/20 focus:outline-none focus:ring-1 focus:ring-danger/50"
          />
        </div>
        <div>
          <label className="block text-xs text-danger mb-1">Critical High</label>
          <input
            type="number"
            step="any"
            value={values.criticalHigh}
            onChange={(e) => setValues({ ...values, criticalHigh: e.target.value })}
            placeholder="None"
            className="w-full px-2 py-1 text-sm bg-surface dark:bg-surface-elevated text-foreground rounded border border-accent/20 focus:outline-none focus:ring-1 focus:ring-danger/50"
          />
        </div>
      </div>

      <div className="mb-4 pt-3 border-t border-accent/10">
        <label className="block text-xs text-muted mb-1">Min Consecutive Blocks</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            step="1"
            value={values.minConsecutiveBlocks}
            onChange={(e) => setValues({ ...values, minConsecutiveBlocks: e.target.value })}
            placeholder="1"
            className="w-24 px-2 py-1 text-sm bg-surface dark:bg-surface-elevated text-foreground rounded border border-accent/20 focus:outline-none focus:ring-1 focus:ring-accent/50"
          />
          <span className="text-xs text-muted">blocks required before alert shows</span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {message && (
            <span className={`text-xs ${message.type === 'success' ? 'text-success' : 'text-danger'}`}>
              {message.text}
            </span>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
          className="px-3 py-1 text-sm btn-gradient-active rounded transition-all disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export function ThresholdEditor() {
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchThresholds();
  }, []);

  const fetchThresholds = async () => {
    try {
      const response = await fetch('/api/admin/thresholds');
      if (!response.ok) {
        throw new Error('Failed to fetch thresholds');
      }
      const data = await response.json();

      // Merge DB thresholds with defaults for any missing metrics
      const dbThresholds = data.thresholds as Threshold[];
      const metricTypes = Object.keys(ANOMALY_THRESHOLDS);

      const merged = metricTypes.map((metricType) => {
        const existing = dbThresholds.find((t) => t.metricType === metricType);
        if (existing) return existing;

        // Use defaults from constants
        const defaults = ANOMALY_THRESHOLDS[metricType as keyof typeof ANOMALY_THRESHOLDS];
        return {
          metricType,
          warningLow: defaults.warning_low,
          warningHigh: defaults.warning_high,
          criticalLow: defaults.critical_low,
          criticalHigh: defaults.critical_high,
          useAbsolute: true,
          minConsecutiveBlocks: defaults.min_consecutive_blocks,
        };
      });

      setThresholds(merged);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load thresholds');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (updated: Threshold) => {
    const response = await fetch('/api/admin/thresholds', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metricType: updated.metricType,
        warningLow: updated.warningLow,
        warningHigh: updated.warningHigh,
        criticalLow: updated.criticalLow,
        criticalHigh: updated.criticalHigh,
        minConsecutiveBlocks: updated.minConsecutiveBlocks,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to save');
    }

    // Update local state
    setThresholds((prev) =>
      prev.map((t) => (t.metricType === updated.metricType ? updated : t))
    );
  };

  if (loading) {
    return <div className="text-muted">Loading thresholds...</div>;
  }

  if (error) {
    return <div className="text-danger">Error: {error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted mb-4">
        Configure when anomalies are detected. Leave a field empty to disable that threshold direction.
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {thresholds.map((threshold) => (
          <ThresholdCard
            key={threshold.metricType}
            threshold={threshold}
            onSave={handleSave}
          />
        ))}
      </div>
    </div>
  );
}
