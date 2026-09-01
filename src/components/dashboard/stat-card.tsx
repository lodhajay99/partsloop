import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function StatCard({
  label,
  value,
  sub,
  tone = 'default',
  icon,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: 'default' | 'brand' | 'info' | 'muted';
  icon?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        tone === 'brand' && 'border-brand/25 bg-brand-soft',
        tone === 'info' && 'border-info/20 bg-info-soft',
        tone === 'muted' && 'bg-muted/40',
        tone === 'default' && 'bg-card',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        {icon}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
