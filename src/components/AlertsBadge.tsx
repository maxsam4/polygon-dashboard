'use client';

import { useEffect, useState } from 'react';

interface AlertCounts {
  total: number;
  critical: number;
  warning: number;
}

export function AlertsBadge() {
  const [counts, setCounts] = useState<AlertCounts | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchCounts = async () => {
      try {
        const res = await fetch(`/api/anomalies?countOnly=true`);
        if (!res.ok || !mounted) return;
        const data = await res.json();
        if (mounted) setCounts(data);
      } catch {
        // Silently fail - badge is not critical
      }
    };

    fetchCounts();
    const interval = setInterval(fetchCounts, 60000); // Refresh every minute
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (!counts || counts.total === 0) {
    return null;
  }

  // Determine badge color based on highest severity
  const hasCritical = counts.critical > 0;
  const bgColor = hasCritical ? 'bg-danger' : 'bg-warning';
  const textColor = hasCritical ? 'text-white' : 'text-black';

  return (
    <span
      className={`${bgColor} ${textColor} text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center`}
      title={`${counts.critical} critical, ${counts.warning} warnings unacknowledged`}
    >
      {counts.total > 99 ? '99+' : counts.total}
    </span>
  );
}
