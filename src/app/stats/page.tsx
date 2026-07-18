'use client';

import { useMemo, useState } from 'react';
import { Nav } from '@/components/Nav';
import { StatCard } from '@/components/StatCard';
import {
  useSummaryStats,
  STATS_TIME_RANGES,
  StatsSelection,
} from '@/hooks/useSummaryStats';
import { formatPol, formatUsd, formatLargeNumber } from '@/lib/utils';
import {
  EXTERNAL_URLS,
  GWEI_PER_POL,
  PRICE_HISTORY_START_MS,
  PRODUCER_PRIORITY_FEE_SHARE,
  TRANSFER_GAS_UNITS,
} from '@/lib/constants';
import { SummaryStats } from '@/lib/types';

// POL amounts: abbreviate once they stop being readable as full numbers,
// and drop decimals from 10k up (they only add width)
function fmtPol(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '-';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return formatLargeNumber(value, decimals);
  if (abs >= 10_000) return formatPol(value, 0);
  return formatPol(value, decimals);
}

function fmtCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  if (Math.abs(value) >= 10_000_000) return formatLargeNumber(value, 2);
  return value.toLocaleString('en-US');
}

function fmtNum(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '-';
  // Big values don't need forced decimals ("6,932.00" -> "6,932")
  const effDecimals = Math.abs(value) >= 100 ? 0 : decimals;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: effDecimals,
    maximumFractionDigits: effDecimals,
  });
}

const SECONDS_PER_YEAR = 365 * 24 * 3600;

// Extrapolate a window total to a per-year run rate
function annualizeOverRange(value: number, range: SummaryStats['range']): number | null {
  const periodSec = range.to - range.from;
  return periodSec > 0 ? value * (SECONDS_PER_YEAR / periodSec) : null;
}

function fmtPctPerYear(pct: number | null | undefined): string | null {
  if (pct === null || pct === undefined) return null;
  return `${pct.toFixed(2)}%/yr`;
}

// "peak 6,932 @ #90,437,541" with the block number linking to the explorer
function PeakSub({ peak, block }: { peak: number | null; block: number | null }) {
  if (peak === null) return null;
  return (
    <>
      peak {fmtNum(peak)}
      {block !== null && (
        <>
          {' @ '}
          <a
            href={`${EXTERNAL_URLS.POLYGONSCAN_BLOCK}${block}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            #{block.toLocaleString('en-US')}
          </a>
        </>
      )}
    </>
  );
}

function formatWindow(range: SummaryStats['range']): string {
  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
  };
  const from = new Date(range.from * 1000).toLocaleString('en-US', opts);
  const to = new Date(range.to * 1000).toLocaleString('en-US', opts);
  return `${from} → ${to} UTC`;
}

// Section eyebrow: uppercase label on a thin accent rule
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent whitespace-nowrap">
          {label}
        </span>
        <div className="h-px flex-1 bg-accent/20" />
      </div>
      {children}
    </section>
  );
}

// Hero card: the number the page leads with, dual-denominated
function HeroCard({
  label,
  primary,
  secondary,
  detail,
  primaryClassName,
}: {
  label: string;
  primary: string;
  secondary?: string;
  detail?: string;
  primaryClassName?: string;
}) {
  return (
    <div className="terminal-card rounded-lg p-5 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent rounded-t-lg" />
      <div className="text-muted text-xs font-medium uppercase tracking-[0.2em] mb-2 pt-1">{label}</div>
      <div className={`text-4xl font-bold font-mono leading-tight ${primaryClassName ?? 'text-accent'}`}>
        {primary}
      </div>
      {secondary && <div className="text-lg font-mono text-foreground mt-1">{secondary}</div>}
      {detail && <div className="text-muted text-xs mt-2">{detail}</div>}
    </div>
  );
}

// All calendar months from the start of indexed data to now, newest first
function monthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const start = new Date(PRICE_HISTORY_START_MS);
  const now = new Date();
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1; // 1-12
  const startY = start.getUTCFullYear();
  const startM = start.getUTCMonth() + 1;
  while (y > startY || (y === startY && m >= startM)) {
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
      month: 'short', year: 'numeric', timeZone: 'UTC',
    });
    options.push({ value: `${y}-${String(m).padStart(2, '0')}`, label });
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return options;
}

function RangePicker({
  selection,
  setSelection,
}: {
  selection: StatsSelection;
  setSelection: (s: StatsSelection) => void;
}) {
  const months = useMemo(monthOptions, []);
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const monthValue =
    selection.kind === 'month'
      ? `${selection.year}-${String(selection.month).padStart(2, '0')}`
      : '';

  const applyCustom = () => {
    if (!customFrom || !customTo) return;
    const fromSec = Math.floor(Date.parse(`${customFrom}T00:00:00Z`) / 1000);
    // inclusive end date: end of that UTC day
    const toSec = Math.floor(Date.parse(`${customTo}T00:00:00Z`) / 1000) + 86400;
    if (!Number.isFinite(fromSec) || !Number.isFinite(toSec) || fromSec >= toSec) return;
    setSelection({ kind: 'custom', fromSec, toSec });
  };

  const inputClass =
    'bg-surface border border-accent/20 rounded px-2 py-1 text-sm text-foreground font-mono ' +
    '[color-scheme:dark] focus:outline-none focus:border-accent/60';

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-1 items-center">
        {STATS_TIME_RANGES.map((range) => (
          <button
            key={range}
            onClick={() => setSelection({ kind: 'preset', range })}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-all duration-150 ${
              selection.kind === 'preset' && selection.range === range
                ? 'btn-gradient-active'
                : 'text-muted hover:text-accent hover:bg-surface-hover'
            }`}
          >
            {range}
          </button>
        ))}
        <select
          value={monthValue}
          onChange={(e) => {
            if (!e.target.value) return;
            const [y, m] = e.target.value.split('-').map(Number);
            setSelection({ kind: 'month', year: y, month: m });
          }}
          className={`px-2 py-1.5 rounded text-sm font-medium bg-transparent cursor-pointer ${
            selection.kind === 'month'
              ? 'btn-gradient-active'
              : 'text-muted hover:text-accent hover:bg-surface-hover'
          }`}
        >
          <option value="" disabled>
            Month
          </option>
          {months.map((m) => (
            <option key={m.value} value={m.value} className="bg-surface text-foreground">
              {m.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowCustom((v) => !v)}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-all duration-150 ${
            selection.kind === 'custom'
              ? 'btn-gradient-active'
              : 'text-muted hover:text-accent hover:bg-surface-hover'
          }`}
        >
          Custom
        </button>
      </div>
      {showCustom && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className={inputClass}
            aria-label="From date (UTC)"
          />
          <span className="text-muted">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className={inputClass}
            aria-label="To date (UTC, inclusive)"
          />
          <button
            onClick={applyCustom}
            disabled={!customFrom || !customTo}
            className="px-3 py-1 rounded text-sm font-medium btn-gradient-active disabled:opacity-40"
          >
            Apply
          </button>
          <span className="text-muted text-xs">UTC days, end inclusive</span>
        </div>
      )}
    </div>
  );
}

export default function StatsPage() {
  const { selection, setSelection, stats, loading, error } = useSummaryStats();

  const totalUsd = stats?.fees.totalUsd ?? null;
  const netInflation = stats?.inflation?.netInflationPol ?? null;
  const priceUsd = stats?.priceUsd ?? null;
  const annualized = stats?.inflation?.annualized ?? null;
  const feesUsdPerYear =
    stats && totalUsd !== null ? annualizeOverRange(totalUsd, stats.range) : null;

  // Cheapest-possible gas price (base + min priority) and what a plain
  // POL / USDC transfer costs at that price
  const minTotalFeeGwei =
    stats?.fees.avgBaseFeeGwei != null && stats.fees.avgMinPriorityFeeGwei != null
      ? stats.fees.avgBaseFeeGwei + stats.fees.avgMinPriorityFeeGwei
      : null;
  const minPolTransferPol =
    minTotalFeeGwei !== null ? (TRANSFER_GAS_UNITS.POL * minTotalFeeGwei) / GWEI_PER_POL : null;
  const minUsdcTransferPol =
    minTotalFeeGwei !== null ? (TRANSFER_GAS_UNITS.USDC * minTotalFeeGwei) / GWEI_PER_POL : null;

  return (
    <div className="min-h-screen bg-background">
      <Nav />

      <main className="w-full px-4 py-6 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <h1 className="text-2xl font-bold text-foreground">Chain Stats</h1>
          <RangePicker selection={selection} setSelection={setSelection} />
        </div>

        {stats && (
          <div className="text-muted text-xs font-mono mb-6">{formatWindow(stats.range)}</div>
        )}

        {loading && !stats && <div className="text-muted">Loading chain stats...</div>}

        {error && (
          <div className="bg-danger/20 text-danger p-4 rounded-lg mb-4">{error}</div>
        )}

        {stats && (
          <div className="space-y-8">
            {/* Hero: the economics of the window */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <HeroCard
                label="Total Fees"
                primary={totalUsd !== null ? formatUsd(totalUsd) : '-'}
                secondary={`${fmtPol(stats.fees.totalPol)} POL`}
                detail={feesUsdPerYear !== null ? `≈${formatUsd(feesUsdPerYear)}/yr` : undefined}
              />
              <HeroCard
                label="POL Price"
                primary={priceUsd !== null ? `$${priceUsd.toFixed(4)}` : '-'}
                detail="latest hourly close"
                primaryClassName="text-foreground"
              />
              <HeroCard
                label="Net POL Inflation"
                primary={netInflation !== null ? `${fmtPol(netInflation)} POL` : '-'}
                secondary={
                  stats.inflation?.netInflationUsd != null
                    ? formatUsd(stats.inflation.netInflationUsd)
                    : undefined
                }
                detail={
                  [
                    stats.inflation?.netInflationPctOfSupply != null
                      ? `${stats.inflation.netInflationPctOfSupply.toFixed(4)}% of supply`
                      : null,
                    fmtPctPerYear(annualized?.netInflationPctOfSupply),
                  ]
                    .filter(Boolean)
                    .join(' · ') || undefined
                }
                primaryClassName={
                  netInflation !== null && netInflation < 0 ? 'text-accent' : 'text-warning'
                }
              />
            </div>

            <Section label="Revenue">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="Base Fee (Burned)"
                  value={`${fmtPol(stats.fees.basePol)} POL`}
                  sub={stats.fees.baseUsd !== null ? formatUsd(stats.fees.baseUsd) : undefined}
                />
                <StatCard
                  label="Priority Fee"
                  value={`${fmtPol(stats.fees.priorityPol)} POL`}
                  sub={stats.fees.priorityUsd !== null ? formatUsd(stats.fees.priorityUsd) : undefined}
                />
                <StatCard
                  label="Producer Revenue"
                  value={`${fmtPol(stats.fees.priorityPol * PRODUCER_PRIORITY_FEE_SHARE)} POL`}
                  sub={
                    stats.fees.priorityUsd !== null
                      ? `${formatUsd(stats.fees.priorityUsd * PRODUCER_PRIORITY_FEE_SHARE)} · ${Math.round(PRODUCER_PRIORITY_FEE_SHARE * 100)}% of priority fees`
                      : `${Math.round(PRODUCER_PRIORITY_FEE_SHARE * 100)}% of priority fees`
                  }
                />
                <StatCard
                  label="Total Fees"
                  value={`${fmtPol(stats.fees.totalPol)} POL`}
                  sub={totalUsd !== null ? formatUsd(totalUsd) : undefined}
                />
              </div>
              {stats.fees.usdMissingHours > 0 && (
                <div className="text-muted text-xs mt-2">
                  USD totals are partial: {stats.fees.usdMissingHours} hour
                  {stats.fees.usdMissingHours === 1 ? '' : 's'} in this window have no price data.
                </div>
              )}
            </Section>

            <Section label="Fees">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                <StatCard
                  label="Avg Tx Fee"
                  value={
                    stats.fees.avgTxFeePol !== null ? `${formatPol(stats.fees.avgTxFeePol, 6)} POL` : '-'
                  }
                  sub={
                    stats.fees.avgTxFeeUsd !== null ? formatUsd(stats.fees.avgTxFeeUsd, 6) : undefined
                  }
                />
                <StatCard
                  label="Min POL Transfer"
                  value={minPolTransferPol !== null ? `${formatPol(minPolTransferPol, 6)} POL` : '-'}
                  sub={
                    minPolTransferPol !== null && priceUsd !== null
                      ? `${formatUsd(minPolTransferPol * priceUsd, 6)} · ${TRANSFER_GAS_UNITS.POL.toLocaleString()} gas`
                      : `${TRANSFER_GAS_UNITS.POL.toLocaleString()} gas`
                  }
                />
                <StatCard
                  label="Min USDC Transfer"
                  value={minUsdcTransferPol !== null ? `${formatPol(minUsdcTransferPol, 6)} POL` : '-'}
                  sub={
                    minUsdcTransferPol !== null && priceUsd !== null
                      ? `${formatUsd(minUsdcTransferPol * priceUsd, 6)} · ${TRANSFER_GAS_UNITS.USDC.toLocaleString()} gas`
                      : `${TRANSFER_GAS_UNITS.USDC.toLocaleString()} gas`
                  }
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <StatCard
                  label="Avg Base Fee"
                  value={
                    stats.fees.avgBaseFeeGwei !== null
                      ? `${fmtNum(stats.fees.avgBaseFeeGwei)} gwei`
                      : '-'
                  }
                  sub="per gas"
                />
                <StatCard
                  label="Avg Priority Fee"
                  value={
                    stats.fees.avgMedianPriorityFeeGwei !== null
                      ? `${fmtNum(stats.fees.avgMedianPriorityFeeGwei)} gwei`
                      : '-'
                  }
                  sub="median, per gas"
                />
                <StatCard
                  label="Avg Min Priority"
                  value={
                    stats.fees.avgMinPriorityFeeGwei !== null
                      ? `${fmtNum(stats.fees.avgMinPriorityFeeGwei)} gwei`
                      : '-'
                  }
                  sub="per gas"
                />
                <StatCard
                  label="Avg Min Total Fee"
                  value={minTotalFeeGwei !== null ? `${fmtNum(minTotalFeeGwei)} gwei` : '-'}
                  sub="base + min priority"
                />
                <StatCard
                  label="Avg Total Fee"
                  value={
                    stats.fees.avgTotalFeeGwei !== null
                      ? `${fmtNum(stats.fees.avgTotalFeeGwei)} gwei`
                      : '-'
                  }
                  sub="base + avg priority"
                />
              </div>
            </Section>

            <Section label="Throughput">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="TPS"
                  value={fmtNum(stats.throughput.avgTps)}
                  sub={
                    stats.throughput.peakTps !== null ? (
                      <PeakSub
                        peak={stats.throughput.peakTps}
                        block={stats.throughput.peakTpsBlock}
                      />
                    ) : undefined
                  }
                />
                <StatCard
                  label="MGAS/s"
                  value={fmtNum(stats.throughput.avgMgas)}
                  sub={
                    stats.throughput.peakMgas !== null ? (
                      <PeakSub
                        peak={stats.throughput.peakMgas}
                        block={stats.throughput.peakMgasBlock}
                      />
                    ) : undefined
                  }
                />
                <StatCard
                  label="Block Utilization"
                  value={
                    stats.blocks.utilizationPct !== null
                      ? `${stats.blocks.utilizationPct.toFixed(1)}%`
                      : '-'
                  }
                  sub="of gas limit"
                />
                <StatCard
                  label="Avg Block Time"
                  value={
                    stats.blocks.avgBlockTimeSec !== null
                      ? `${stats.blocks.avgBlockTimeSec.toFixed(2)}s`
                      : '-'
                  }
                />
              </div>
            </Section>

            <Section label="Activity">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Transactions" value={fmtCount(stats.blocks.txCount)} />
                <StatCard
                  label="Blocks"
                  value={fmtCount(stats.blocks.count)}
                  sub={
                    stats.blocks.blockStart !== null && stats.blocks.blockEnd !== null
                      ? `#${stats.blocks.blockStart.toLocaleString()} → #${stats.blocks.blockEnd.toLocaleString()}`
                      : undefined
                  }
                />
                <StatCard
                  label="Gas Used"
                  value={formatLargeNumber(stats.blocks.gasUsedSum, 2)}
                />
                <StatCard
                  label="Avg Finality"
                  value={
                    stats.blocks.avgFinalitySec !== null
                      ? `${stats.blocks.avgFinalitySec.toFixed(1)}s`
                      : '-'
                  }
                />
              </div>
            </Section>

            {stats.inflation && (
              <Section label="Supply">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard
                    label="POL Issued"
                    value={`${fmtPol(stats.inflation.issuancePol)} POL`}
                    sub={
                      <>
                        {priceUsd !== null && (
                          <div>{formatUsd(stats.inflation.issuancePol * priceUsd)} at latest price</div>
                        )}
                        {annualized && (
                          <div>
                            {fmtPol(annualized.issuancePol)} POL/yr
                            {annualized.issuancePctOfSupply !== null &&
                              ` · ${fmtPctPerYear(annualized.issuancePctOfSupply)}`}
                          </div>
                        )}
                      </>
                    }
                  />
                  <StatCard
                    label="POL Burned"
                    value={`${fmtPol(stats.inflation.burnedPol)} POL`}
                    sub={
                      <>
                        <div>
                          {stats.fees.baseUsd !== null
                            ? `${formatUsd(stats.fees.baseUsd)} · base fees`
                            : 'base fees'}
                        </div>
                        {annualized && (
                          <div>
                            {fmtPol(annualized.burnedPol)} POL/yr
                            {annualized.burnedPctOfSupply !== null &&
                              ` · ${fmtPctPerYear(annualized.burnedPctOfSupply)}`}
                          </div>
                        )}
                      </>
                    }
                  />
                  <StatCard
                    label="Net Inflation"
                    value={`${fmtPol(stats.inflation.netInflationPol)} POL`}
                    sub={
                      <>
                        {stats.inflation.netInflationPctOfSupply !== null && (
                          <div>{stats.inflation.netInflationPctOfSupply.toFixed(4)}% of supply</div>
                        )}
                        {annualized && (
                          <div>
                            {fmtPol(annualized.netInflationPol)} POL/yr
                            {annualized.netInflationPctOfSupply !== null &&
                              ` · ${fmtPctPerYear(annualized.netInflationPctOfSupply)}`}
                          </div>
                        )}
                      </>
                    }
                    valueClassName={
                      stats.inflation.netInflationPol < 0 ? 'text-accent' : 'text-warning'
                    }
                  />
                  <StatCard
                    label="Net Inflation (USD)"
                    value={
                      stats.inflation.netInflationUsd !== null
                        ? formatUsd(stats.inflation.netInflationUsd)
                        : '-'
                    }
                    sub={
                      <>
                        <div>at latest price</div>
                        {annualized?.netInflationUsd != null && (
                          <div>{formatUsd(annualized.netInflationUsd)}/yr</div>
                        )}
                      </>
                    }
                  />
                </div>
              </Section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
