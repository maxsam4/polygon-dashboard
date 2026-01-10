'use client';

import { useState, useCallback } from 'react';
import { Nav } from '@/components/Nav';

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
  blockTimeSec: number | null;
  mgasPerSec: number | null;
  tps: number | null;
  totalBaseFeeGwei: number;
  totalPriorityFeeGwei: number;
  finalized: boolean;
  timeToFinalitySec: number | null;
}

const ALL_COLUMNS = [
  { key: 'blockNumber', label: 'Block Number', default: true },
  { key: 'timestamp', label: 'Timestamp', default: true },
  { key: 'gasUsedPercent', label: 'Gas Used %', default: true },
  { key: 'baseFeeGwei', label: 'Base Fee (Gwei)', default: true },
  { key: 'medianPriorityFeeGwei', label: 'Median Priority Fee', default: true },
  { key: 'avgPriorityFeeGwei', label: 'Avg Priority Fee', default: false },
  { key: 'minPriorityFeeGwei', label: 'Min Priority Fee', default: false },
  { key: 'maxPriorityFeeGwei', label: 'Max Priority Fee', default: false },
  { key: 'txCount', label: 'Transaction Count', default: true },
  { key: 'gasUsed', label: 'Gas Used', default: false },
  { key: 'gasLimit', label: 'Gas Limit', default: false },
  { key: 'blockTimeSec', label: 'Block Time (s)', default: true },
  { key: 'mgasPerSec', label: 'MGAS/s', default: true },
  { key: 'tps', label: 'TPS', default: true },
  { key: 'totalBaseFeeGwei', label: 'Total Base Fee', default: false },
  { key: 'totalPriorityFeeGwei', label: 'Total Priority Fee', default: false },
  { key: 'finalized', label: 'Finalized', default: true },
  { key: 'timeToFinalitySec', label: 'Time to Finality (s)', default: true },
];

const TIME_PRESETS = [
  { label: 'Last Hour', value: 'hour' },
  { label: 'Last Day', value: 'day' },
  { label: 'Last Week', value: 'week' },
  { label: 'Last Month', value: 'month' },
  { label: 'Last Year', value: 'year' },
  { label: 'All Time', value: 'all' },
  { label: 'Custom Range', value: 'custom' },
];

function formatDateTime(date: Date): string {
  return date.toISOString().slice(0, 16);
}

function getPresetDates(preset: string): { from: Date | null; to: Date | null } {
  const now = new Date();
  let from: Date | null = null;
  const to = now;

  switch (preset) {
    case 'hour':
      from = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case 'day':
      from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case 'week':
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'year':
      from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    case 'all':
      from = null;
      break;
  }

  return { from, to };
}

export default function ExportPage() {
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    new Set(ALL_COLUMNS.filter((c) => c.default).map((c) => c.key))
  );
  const [timePreset, setTimePreset] = useState('day');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [fromBlock, setFromBlock] = useState('');
  const [toBlock, setToBlock] = useState('');
  const [selectionMode, setSelectionMode] = useState<'time' | 'block'>('time');
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<{ fetched: number; total: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleColumn = (key: string) => {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllColumns = () => {
    setSelectedColumns(new Set(ALL_COLUMNS.map((c) => c.key)));
  };

  const selectDefaultColumns = () => {
    setSelectedColumns(new Set(ALL_COLUMNS.filter((c) => c.default).map((c) => c.key)));
  };

  const clearAllColumns = () => {
    setSelectedColumns(new Set(['blockNumber', 'timestamp']));
  };

  const handlePresetChange = (preset: string) => {
    setTimePreset(preset);
    if (preset !== 'custom') {
      const { from, to } = getPresetDates(preset);
      if (from) setCustomFrom(formatDateTime(from));
      if (to) setCustomTo(formatDateTime(to));
    }
  };

  const formatValue = (key: string, value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (key === 'finalized') return value ? 'Yes' : 'No';
    if (key === 'gasUsedPercent') return (value as number).toFixed(2);
    if (['baseFeeGwei', 'avgPriorityFeeGwei', 'medianPriorityFeeGwei', 'minPriorityFeeGwei', 'maxPriorityFeeGwei', 'totalBaseFeeGwei', 'totalPriorityFeeGwei'].includes(key)) {
      return (value as number).toFixed(4);
    }
    if (['mgasPerSec', 'tps', 'blockTimeSec', 'timeToFinalitySec'].includes(key)) {
      return (value as number).toFixed(2);
    }
    return String(value);
  };

  const handleExport = useCallback(async () => {
    setExporting(true);
    setError(null);
    setProgress({ fetched: 0, total: null });

    try {
      const params = new URLSearchParams();
      params.set('limit', '50000');

      if (selectionMode === 'time') {
        if (timePreset === 'custom') {
          if (customFrom) params.set('fromTime', new Date(customFrom).toISOString());
          if (customTo) params.set('toTime', new Date(customTo).toISOString());
        } else if (timePreset !== 'all') {
          const { from, to } = getPresetDates(timePreset);
          if (from) params.set('fromTime', from.toISOString());
          if (to) params.set('toTime', to.toISOString());
        }
      } else {
        if (fromBlock) params.set('fromBlock', fromBlock);
        if (toBlock) params.set('toBlock', toBlock);
      }

      const response = await fetch(`/api/export?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Export failed');
      }

      const blocks: BlockData[] = data.blocks || [];
      setProgress({ fetched: blocks.length, total: data.total });

      if (blocks.length === 0) {
        setError('No blocks found in the specified range');
        return;
      }

      // Build CSV
      const selectedColumnsList = ALL_COLUMNS.filter((c) => selectedColumns.has(c.key));
      const headers = selectedColumnsList.map((c) => c.label);
      const rows = blocks.map((b) =>
        selectedColumnsList.map((c) => formatValue(c.key, b[c.key as keyof BlockData]))
      );

      const csvContent = [headers, ...rows]
        .map((row) => row.map((cell) => `"${cell}"`).join(','))
        .join('\n');

      // Download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
      link.href = URL.createObjectURL(blob);
      link.download = `polygon-blocks-${timestamp}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [selectionMode, timePreset, customFrom, customTo, fromBlock, toBlock, selectedColumns]);

  return (
    <div className="min-h-screen">
      <Nav />

      <main className="w-full px-4 py-6 max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Export Data</h1>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Range Selection */}
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Select Range</h2>

            <div className="flex gap-4 mb-4">
              <button
                onClick={() => setSelectionMode('time')}
                className={`px-4 py-2 rounded ${
                  selectionMode === 'time'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 dark:bg-gray-700'
                }`}
              >
                By Time
              </button>
              <button
                onClick={() => setSelectionMode('block')}
                className={`px-4 py-2 rounded ${
                  selectionMode === 'block'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 dark:bg-gray-700'
                }`}
              >
                By Block Number
              </button>
            </div>

            {selectionMode === 'time' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {TIME_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      onClick={() => handlePresetChange(preset.value)}
                      className={`px-3 py-2 rounded text-sm ${
                        timePreset === preset.value
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {timePreset === 'custom' && (
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div>
                      <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                        From
                      </label>
                      <input
                        type="datetime-local"
                        value={customFrom}
                        onChange={(e) => setCustomFrom(e.target.value)}
                        className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                        To
                      </label>
                      <input
                        type="datetime-local"
                        value={customTo}
                        onChange={(e) => setCustomTo(e.target.value)}
                        className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700"
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                    From Block
                  </label>
                  <input
                    type="text"
                    value={fromBlock}
                    onChange={(e) => setFromBlock(e.target.value)}
                    placeholder="e.g., 65000000"
                    className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                    To Block
                  </label>
                  <input
                    type="text"
                    value={toBlock}
                    onChange={(e) => setToBlock(e.target.value)}
                    placeholder="e.g., 65100000"
                    className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Column Selection */}
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Select Columns</h2>
              <div className="flex gap-2">
                <button
                  onClick={selectAllColumns}
                  className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  All
                </button>
                <button
                  onClick={selectDefaultColumns}
                  className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  Default
                </button>
                <button
                  onClick={clearAllColumns}
                  className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  Minimal
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
              {ALL_COLUMNS.map((col) => (
                <label
                  key={col.key}
                  className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedColumns.has(col.key)}
                    onChange={() => toggleColumn(col.key)}
                    className="rounded"
                  />
                  <span className="text-sm">{col.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Export Button */}
        <div className="mt-6 flex flex-col items-center gap-4">
          <button
            onClick={handleExport}
            disabled={exporting || selectedColumns.size === 0}
            className="px-8 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 font-semibold"
          >
            {exporting ? 'Exporting...' : 'Export to CSV'}
          </button>

          {progress && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Fetched {progress.fetched.toLocaleString()} blocks
              {progress.total ? ` of ${progress.total.toLocaleString()} total` : ''}
            </p>
          )}

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <p className="text-xs text-gray-500 dark:text-gray-500">
            Maximum 50,000 blocks per export. For larger exports, use multiple ranges.
          </p>
        </div>
      </main>
    </div>
  );
}
