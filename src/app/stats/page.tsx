'use client';

import { Nav } from '@/components/Nav';
import { StatCard } from '@/components/StatCard';
import { useSummaryStats, STATS_TIME_RANGES } from '@/hooks/useSummaryStats';
import { formatPol, formatUsd, formatLargeNumber } from '@/lib/utils';
import { SummaryStats } from '@/lib/types';

// POL amounts: abbreviate once they stop being readable as full numbers
function fmtPol(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '-';
  if (Math.abs(value) >= 1_000_000) return formatLargeNumber(value, decimals);
  return formatPol(value, decimals);
}

function fmtCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  if (Math.abs(value) >= 10_000_000) return formatLargeNumber(value, 2);
  return value.toLocaleString('en-US');
}

function fmtNum(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '-';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
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

export default function StatsPage() {
  const { timeRange, setTimeRange, stats, loading, error } = useSummaryStats();

  const totalUsd = stats?.fees.totalUsd ?? null;
  const netInflation = stats?.inflation?.netInflationPol ?? null;

  return (
    <div className="min-h-screen bg-background">
      <Nav />

      <main className="w-full px-4 py-6 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h1 className="text-2xl font-bold text-foreground">Chain Stats</h1>
          <div className="flex flex-wrap gap-1">
            {STATS_TIME_RANGES.map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-all duration-150 ${
                  timeRange === range
                    ? 'btn-gradient-active'
                    : 'text-muted hover:text-accent hover:bg-surface-hover'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
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
                detail={`base ${fmtPol(stats.fees.basePol)} · priority ${fmtPol(stats.fees.priorityPol)} POL`}
              />
              <HeroCard
                label="POL Price"
                primary={stats.priceUsd !== null ? `$${stats.priceUsd.toFixed(4)}` : '-'}
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
                  stats.inflation?.netInflationPctOfSupply != null
                    ? `${stats.inflation.netInflationPctOfSupply.toFixed(4)}% of supply · issuance − burn`
                    : 'issuance − burn'
                }
                primaryClassName={
                  netInflation !== null && netInflation < 0 ? 'text-accent' : 'text-warning'
                }
              />
            </div>

            <Section label="Fees">
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
                  label="Avg Tx Fee"
                  value={
                    stats.fees.avgTxFeePol !== null ? `${formatPol(stats.fees.avgTxFeePol, 6)} POL` : '-'
                  }
                  sub={
                    stats.fees.avgTxFeeUsd !== null ? formatUsd(stats.fees.avgTxFeeUsd, 6) : undefined
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

            <Section label="Throughput">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="TPS"
                  value={fmtNum(stats.throughput.avgTps)}
                  sub={
                    stats.throughput.peakTps !== null
                      ? `peak ${fmtNum(stats.throughput.peakTps)}`
                      : undefined
                  }
                />
                <StatCard
                  label="MGAS/s"
                  value={fmtNum(stats.throughput.avgMgas)}
                  sub={
                    stats.throughput.peakMgas !== null
                      ? `peak ${fmtNum(stats.throughput.peakMgas)}`
                      : undefined
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
                  />
                  <StatCard
                    label="POL Burned"
                    value={`${fmtPol(stats.inflation.burnedPol)} POL`}
                    sub="base fees (EIP-1559)"
                  />
                  <StatCard
                    label="Net Inflation"
                    value={`${fmtPol(stats.inflation.netInflationPol)} POL`}
                    sub={
                      stats.inflation.netInflationPctOfSupply !== null
                        ? `${stats.inflation.netInflationPctOfSupply.toFixed(4)}% of supply`
                        : undefined
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
                    sub="at latest price"
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
