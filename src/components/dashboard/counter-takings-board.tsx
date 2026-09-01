import Link from 'next/link';
import { Banknote, PackageMinus, Plus, QrCode, Store } from 'lucide-react';

import { SeedBadge, SimulatedBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { dateTime, rupees } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CounterTakings } from '@/lib/data/bills';
import type { BillStatus } from '@/types/db';

/**
 * Money taken over the counter from walk-in customers.
 *
 * Separated from the headline stats because it answers a different question:
 * not "how did the month go" but "what has the till done today, and is anything
 * still hanging". A paid bill whose stock has not been cut is the one state a
 * shopkeeper needs pushed at them, so it gets its own callout.
 */

const BILL_STATUS_META: Record<BillStatus, { label: string; className: string }> = {
  created: { label: 'awaiting payment', className: 'bg-muted text-muted-foreground' },
  paid: { label: 'cut stock', className: 'bg-warning-soft text-warning' },
  stocked: { label: 'done', className: 'bg-success-soft text-success' },
  cancelled: { label: 'cancelled', className: 'bg-destructive/10 text-destructive' },
};

export function CounterTakingsBoard({ takings }: { takings: CounterTakings }) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Store className="size-4 text-brand" aria-hidden />
          Walk-in counter
        </h2>
        <Button render={<Link href="/sales/new" />} nativeButton={false} size="sm">
          <Plus className="size-3.5" aria-hidden />
          New bill
        </Button>
      </div>

      <dl className="grid grid-cols-2 divide-x divide-y border-b sm:grid-cols-4 sm:divide-y-0">
        <Figure
          label={takings.isCurrentMonth ? 'Taken today' : 'Busiest day'}
          value={rupees(takings.todayPaise)}
          sub={
            takings.isCurrentMonth
              ? `${takings.todayCount} bills`
              : `${takings.bestDayLabel ?? '—'} · ${takings.todayCount} bills`
          }
          highlight
        />
        <Figure
          label="This month"
          value={rupees(takings.monthPaise)}
          sub={`${takings.monthCount} bills`}
        />
        <Figure
          label="Razorpay / cash"
          value={`${rupees(takings.razorpayPaise)} / ${rupees(takings.cashPaise)}`}
          sub={`${takings.razorpayCount} scanned · ${takings.cashCount} in cash`}
        />
        <Figure
          label="Needs attention"
          value={String(takings.awaitingStock + takings.awaitingPayment)}
          sub={
            takings.awaitingStock + takings.awaitingPayment === 0
              ? 'all clear'
              : `${takings.awaitingStock} to cut · ${takings.awaitingPayment} unpaid`
          }
        />
      </dl>

      {takings.awaitingStock > 0 ? (
        <p className="flex items-start gap-2.5 border-b bg-warning-soft/60 px-4 py-2.5 text-xs sm:px-5">
          <PackageMinus className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
          <span>
            <span className="font-medium text-warning">
              {takings.awaitingStock} paid {takings.awaitingStock === 1 ? 'bill has' : 'bills have'}{' '}
              stock still on the shelf.
            </span>{' '}
            Open the bill and cut stock once the parts have left the counter — until then other shops
            can still find them in search.
          </span>
        </p>
      ) : null}

      {takings.recent.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground sm:px-5">
          No counter bills this month yet.{' '}
          <Link href="/sales/new" className="underline">
            Start one
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y">
          {takings.recent.map((bill) => {
            const meta = BILL_STATUS_META[bill.status];
            return (
              <li key={bill.id}>
                <Link
                  href={`/bills/${bill.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 transition-colors hover:bg-accent/40 sm:px-5"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="font-mono text-xs text-muted-foreground">
                      #{String(bill.bill_number).padStart(4, '0')}
                    </span>
                    <span className="truncate text-sm">
                      {bill.item_count} {bill.item_count === 1 ? 'line' : 'lines'} ·{' '}
                      {bill.unit_count} {bill.unit_count === 1 ? 'item' : 'items'}
                    </span>
                    <span
                      title={
                        bill.payment_method === 'cash'
                          ? 'Paid in cash — no Razorpay record behind this bill'
                          : 'Charged through Razorpay'
                      }
                      className="text-muted-foreground"
                    >
                      {bill.payment_method === 'cash' ? (
                        <Banknote className="size-3.5" aria-label="cash" />
                      ) : (
                        <QrCode className="size-3.5" aria-label="Razorpay" />
                      )}
                    </span>
                    {bill.is_seed ? <SeedBadge /> : bill.simulated ? <SimulatedBadge /> : null}
                  </span>

                  <span className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {dateTime(bill.paid_at ?? bill.created_at)}
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
                        meta.className,
                      )}
                    >
                      {meta.label}
                    </span>
                    <span className="w-20 text-right text-sm font-medium tabular-nums">
                      {rupees(bill.total_paise)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Figure({
  label,
  value,
  sub,
  highlight = false,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn('px-4 py-3 sm:px-5', highlight && 'bg-brand-soft/40')}>
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1 text-lg font-semibold tabular-nums',
          highlight && 'text-brand',
        )}
      >
        {value}
      </dd>
      <dd className="text-xs text-muted-foreground">{sub}</dd>
    </div>
  );
}
