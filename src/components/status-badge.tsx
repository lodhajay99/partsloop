import { cn } from '@/lib/utils';
import type { TransactionStatus } from '@/types/db';

/** Plain-language status labels — shop owners do not read state machines. */
const STATUS_META: Record<TransactionStatus, { label: string; className: string }> = {
  created: { label: 'Awaiting payment', className: 'bg-muted text-muted-foreground' },
  reserved: { label: 'Reserved', className: 'bg-info-soft text-info' },
  paid: { label: 'Paid', className: 'bg-success-soft text-success' },
  on_hold: { label: 'Paid · held', className: 'bg-warning-soft text-warning' },
  released: { label: 'Released to seller', className: 'bg-success-soft text-success' },
  completed: { label: 'Completed', className: 'bg-success-soft text-success' },
  expired: { label: 'Expired', className: 'bg-muted text-muted-foreground line-through' },
  refunded: { label: 'Refunded', className: 'bg-destructive/10 text-destructive' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground line-through' },
};

export function StatusBadge({ status, className }: { status: TransactionStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        meta.className,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

/**
 * Marks anything that did not actually move money through Razorpay: seeded
 * demo history, or a Route split against a mock Linked Account. Judges should
 * be able to tell the real calls from the stand-ins at a glance.
 */
export function SimulatedBadge({ reason, className }: { reason?: string; className?: string }) {
  return (
    <span
      title={reason}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning',
        className,
      )}
    >
      simulated
    </span>
  );
}

export function SeedBadge({ className }: { className?: string }) {
  return (
    <span
      title="Backdated demo history. This row was seeded, not charged through Razorpay."
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground',
        className,
      )}
    >
      seed
    </span>
  );
}
