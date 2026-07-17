/**
 * Shared stat/summary card components (extracted from the RPC stats page,
 * reused by /stats).
 */

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="terminal-card rounded-lg p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent rounded-t-lg" />
      <h3 className="text-lg font-semibold text-foreground mb-3 pt-1">{title}</h3>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <div className="terminal-card rounded-lg p-4 text-center">
      <div className="text-muted text-xs font-medium uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono ${valueClassName ?? 'text-foreground'}`}>{value}</div>
      {sub && <div className="text-muted text-xs mt-1">{sub}</div>}
    </div>
  );
}
