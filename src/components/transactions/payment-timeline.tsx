import { Check, Circle, Clock } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { TransactionStatus, TransactionType } from '@/types/db';

interface Step {
  key: string;
  label: string;
  detail: string;
}

const INTER_SHOP_STEPS: Step[] = [
  { key: 'reserved', label: 'Reserved', detail: 'Stock held for you; seller revealed' },
  { key: 'paid', label: 'Paid', detail: 'Razorpay captured the payment' },
  { key: 'on_hold', label: 'Held', detail: "Seller's share parked by Route, not settled" },
  { key: 'released', label: 'Released', detail: 'You confirmed handoff; seller gets settled' },
];

const RETAIL_STEPS: Step[] = [
  { key: 'created', label: 'Charge created', detail: 'Razorpay order + payment link issued' },
  { key: 'paid', label: 'Paid', detail: 'Customer paid; stock decremented' },
  { key: 'completed', label: 'In the ledger', detail: "Counted in this month's dashboard" },
];

/** How far along each status is, per flow. */
const PROGRESS: Record<TransactionStatus, number> = {
  created: 0,
  reserved: 1,
  paid: 2,
  on_hold: 3,
  released: 4,
  completed: 4,
  expired: -1,
  refunded: -1,
};

export function PaymentTimeline({
  type,
  status,
}: {
  type: TransactionType;
  status: TransactionStatus;
}) {
  const steps = type === 'inter_shop_purchase' ? INTER_SHOP_STEPS : RETAIL_STEPS;

  const reached = (index: number) => {
    if (status === 'expired' || status === 'refunded') return false;
    if (type === 'inter_shop_purchase') return PROGRESS[status] >= index + 1;
    // Retail: created -> paid -> completed maps onto three steps.
    if (index === 0) return true;
    return PROGRESS[status] >= 2 + (index - 1) * 2;
  };

  return (
    <ol className="space-y-3">
      {steps.map((step, i) => {
        const done = reached(i);
        const current = done && !reached(i + 1);

        return (
          <li key={step.key} className="flex gap-3">
            <span
              className={cn(
                'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border',
                done ? 'border-success bg-success text-white' : 'border-border bg-muted',
              )}
              aria-hidden
            >
              {done ? (
                <Check className="size-3" strokeWidth={3} />
              ) : (
                <Circle className="size-2 fill-muted-foreground/40 text-muted-foreground/40" />
              )}
            </span>
            <div className="min-w-0">
              <p className={cn('text-sm font-medium', !done && 'text-muted-foreground')}>
                {step.label}
                {current ? (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">
                    <Clock className="size-2.5" aria-hidden />
                    now
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
