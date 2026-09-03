'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, Banknote, Store } from 'lucide-react';

import { SeedBadge, SimulatedBadge, StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { dateTime, rupees, rupeesPrecise } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LedgerEntry } from '@/lib/data/dashboard';

type Filter = 'all' | 'retail_sale' | 'sold_to_shop' | 'bought_from_shop';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'Everything' },
  { key: 'retail_sale', label: 'Counter sales' },
  { key: 'sold_to_shop', label: 'Sold to shops' },
  { key: 'bought_from_shop', label: 'Bought from shops' },
];

const DIRECTION_META = {
  retail_sale: { icon: Store, label: 'Counter sale', tone: 'text-brand' },
  sold_to_shop: { icon: ArrowUpRight, label: 'Sold to shop', tone: 'text-success' },
  bought_from_shop: { icon: ArrowDownLeft, label: 'Bought from shop', tone: 'text-info' },
} as const;

export function LedgerTable({ entries }: { entries: LedgerEntry[] }) {
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(
    () => (filter === 'all' ? entries : entries.filter((e) => e.direction === filter)),
    [entries, filter],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(({ key, label }) => {
          const count = key === 'all' ? entries.length : entries.filter((e) => e.direction === key).length;
          return (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? 'default' : 'outline'}
              onClick={() => setFilter(key)}
            >
              {label}
              <span className={cn('ml-1.5 tabular-nums', filter === key ? 'opacity-70' : 'text-muted-foreground')}>
                {count}
              </span>
            </Button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing here this month.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-muted/50 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">Part</th>
                <th className="px-3 py-2 text-left font-medium">Kind</th>
                <th className="px-3 py-2 text-left font-medium">Counterparty</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const meta = DIRECTION_META[e.direction];
                const Icon = meta.icon;
                const outgoing = e.direction === 'bought_from_shop';
                return (
                  <tr key={e.id} className="border-t transition-colors hover:bg-accent/40">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {dateTime(e.created_at)}
                    </td>
                    <td className="max-w-[16rem] px-3 py-2">
                      <Link
                        href={e.bill_id ? `/bills/${e.bill_id}` : `/transactions/${e.id}`}
                        className="font-medium hover:underline"
                      >
                        {e.part_name}
                      </Link>
                      <span className="ml-1.5 text-xs text-muted-foreground">x{e.quantity}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={cn('inline-flex items-center gap-1.5', meta.tone)}>
                        <Icon className="size-3.5" aria-hidden />
                        <span className="text-xs font-medium">{meta.label}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {e.direction === 'retail_sale'
                        ? 'Walk-in customer'
                        : e.direction === 'sold_to_shop'
                          ? (e.buyer_name ?? '—')
                          : e.seller_name}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <StatusBadge status={e.status} />
                        {e.payment_method === 'cash' ? (
                          <span
                            title="Paid in cash — no Razorpay record behind this row"
                            className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                          >
                            <Banknote className="size-3" aria-hidden />
                            cash
                          </span>
                        ) : e.is_seed ? (
                          <SeedBadge />
                        ) : e.simulated ? (
                          <SimulatedBadge />
                        ) : null}
                      </span>
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-medium tabular-nums whitespace-nowrap',
                        outgoing ? 'text-muted-foreground' : '',
                      )}
                    >
                      {outgoing ? '−' : '+'}
                      {rupees(e.amount_paise)}
                      {e.platform_fee_paise > 0 && e.direction === 'sold_to_shop' ? (
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          {/* Exact: rounding ₹8.53 to ₹9 overstates a small fee by 5%. */}
                          −{rupeesPrecise(e.platform_fee_paise)} fee
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
