import Link from 'next/link';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Store, TrendingUp } from 'lucide-react';

import { CounterTakingsBoard } from '@/components/dashboard/counter-takings-board';
import { MonthSwitcher } from '@/components/dashboard/month-switcher';
import { LedgerTable } from '@/components/dashboard/ledger-table';
import { RevenueChart } from '@/components/dashboard/revenue-chart';
import { StatCard } from '@/components/dashboard/stat-card';
import { IntegrationBanner } from '@/components/integration-banner';
import { Button } from '@/components/ui/button';
import { requireSessionShop } from '@/lib/auth/session';
import { getCounterTakings } from '@/lib/data/bills';
import {
  getDashboardData,
  getLatestMonthWithActivity,
  LOW_STOCK_THRESHOLD,
  parseMonthParam,
} from '@/lib/data/dashboard';
import { expireStaleReservations } from '@/lib/data/fulfilment';
import { rupees } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Dashboard · PartLoop' };

export default async function DashboardPage({ searchParams }: PageProps<'/dashboard'>) {
  const shop = await requireSessionShop();

  // No cron in this build; reservations are swept whenever a page loads.
  await expireStaleReservations();

  // Which month to show: an explicit ?month=YYYY-MM wins, otherwise the latest
  // month this shop actually traded in. Defaulting to "now" would show an empty
  // page for the first days of every month.
  const now = new Date();
  const params = await searchParams;
  const requested = parseMonthParam(
    typeof params.month === 'string' ? params.month : undefined,
    now,
  );
  const ref = requested ?? (await getLatestMonthWithActivity(shop.id)) ?? now;

  const [data, takings] = await Promise.all([
    getDashboardData(shop.id, ref),
    getCounterTakings(shop.id, ref, now),
  ]);

  const showingThisMonth =
    ref.getFullYear() === now.getFullYear() && ref.getMonth() === now.getMonth();
  // Dim only the days that have not happened yet, and only in the live month.
  const today = showingThisMonth ? now.getDate() : 32;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">{data.monthLabel}</p>
            <MonthSwitcher month={ref} now={now} />
            {!showingThisMonth ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                closed month
              </span>
            ) : null}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{shop.name}</h1>
        </div>
        <div className="flex gap-2">
          <Button render={<Link href="/search" />} nativeButton={false} variant="outline">
            Find a part nearby
          </Button>
          <Button render={<Link href="/sales/new" />} nativeButton={false}>
            New counter bill
          </Button>
        </div>
      </div>

      <IntegrationBanner />

      <p className="text-sm text-muted-foreground">
        Every figure below is computed from the <code>transactions</code> table and nothing else.
        There is no separate bookkeeping — because each sale, to a customer or to another shop, was
        charged through Razorpay, the month&apos;s books fall out of the payment records.
      </p>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Money in this month"
          value={rupees(data.totalEarnedPaise)}
          tone="brand"
          icon={<TrendingUp className="size-4 text-brand" aria-hidden />}
          sub={`${data.totalTransactions} settled ${data.totalTransactions === 1 ? 'payment' : 'payments'}`}
        />
        <StatCard
          label="Counter sales"
          value={rupees(data.retail.grossPaise)}
          icon={<Store className="size-4 text-muted-foreground" aria-hidden />}
          sub={`${data.retail.count} walk-in ${data.retail.count === 1 ? 'sale' : 'sales'}`}
        />
        <StatCard
          label="Sold to other shops"
          value={rupees(data.soldToShops.grossPaise - data.soldToShops.feePaise)}
          icon={<ArrowUpRight className="size-4 text-success" aria-hidden />}
          sub={
            data.soldToShops.count > 0
              ? `${data.soldToShops.count} trades · ${rupees(data.soldToShops.feePaise)} platform fee`
              : 'No wholesale trades yet'
          }
        />
        <StatCard
          label="Bought from other shops"
          value={rupees(data.boughtFromShops.grossPaise)}
          tone="muted"
          icon={<ArrowDownLeft className="size-4 text-info" aria-hidden />}
          sub={`${data.boughtFromShops.count} ${data.boughtFromShops.count === 1 ? 'purchase' : 'purchases'}`}
        />
      </section>

      {data.pendingReservations > 0 || data.awaitingRelease > 0 ? (
        <section className="flex flex-wrap items-center gap-3 rounded-lg border border-info/25 bg-info-soft px-4 py-3 text-sm">
          <span className="font-medium text-info">Needs your attention</span>
          {data.pendingReservations > 0 ? (
            <span>
              {data.pendingReservations} reservation{data.pendingReservations === 1 ? '' : 's'}{' '}
              awaiting payment
            </span>
          ) : null}
          {data.awaitingRelease > 0 ? (
            <span>
              {data.awaitingRelease} paid purchase{data.awaitingRelease === 1 ? '' : 's'} still held —
              mark received to release the seller&apos;s money
            </span>
          ) : null}
        </section>
      ) : null}

      <CounterTakingsBoard takings={takings} />

      <section className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Day by day</h2>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-xs bg-chart-1" aria-hidden /> Counter sales
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-xs bg-chart-2" aria-hidden /> Sold to shops (net of fee)
            </span>
          </div>
        </div>
        <RevenueChart data={data.daily} today={today} />
      </section>

      {data.lowStock.length > 0 ? (
        <section className="rounded-xl border border-warning/25 bg-warning-soft/50 p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" aria-hidden />
            <h2 className="text-sm font-semibold">
              Running low ({data.lowStock.length}) — under {LOW_STOCK_THRESHOLD} in stock
            </h2>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.lowStock.map((line) => (
              <li
                key={line.part_id}
                className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">{line.part_name}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-medium">{line.quantity}</span>
                  <span className="text-muted-foreground"> left · {rupees(line.price_paise)}</span>
                </span>
              </li>
            ))}
          </ul>
          <Button
            render={<Link href="/inventory" />}
            nativeButton={false}
            variant="outline"
            size="sm"
            className="mt-3"
          >
            Update my stock
          </Button>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">This month&apos;s transactions</h2>
        <LedgerTable entries={data.entries} />
      </section>
    </div>
  );
}
