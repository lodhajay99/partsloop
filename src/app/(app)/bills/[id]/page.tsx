import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { ArrowLeft, Ban, Banknote, CheckCircle2, PackageMinus, Smartphone } from 'lucide-react';

import { BillActions } from '@/components/bills/bill-actions';
import { CancelBillButton } from '@/components/bills/cancel-bill-button';
import { SeedBadge, SimulatedBadge } from '@/components/status-badge';
import { RazorpayRefs } from '@/components/transactions/razorpay-refs';
import { requireSessionShop } from '@/lib/auth/session';
import { getBill } from '@/lib/data/bills';
import { dateTime, rupees, rupeesPrecise } from '@/lib/format';
import { isSimulated, paymentFeeBps } from '@/lib/razorpay/client';
import { cn } from '@/lib/utils';
import type { BillStatus } from '@/types/db';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Bill · PartLoop' };

const STATUS_META: Record<BillStatus, { label: string; className: string }> = {
  created: { label: 'Awaiting payment', className: 'bg-muted text-muted-foreground' },
  paid: { label: 'Paid · stock still on shelf', className: 'bg-warning-soft text-warning' },
  stocked: { label: 'Paid · stock cut', className: 'bg-success-soft text-success' },
  cancelled: { label: 'Cancelled', className: 'bg-destructive/10 text-destructive' },
};

export default async function BillPage({ params }: PageProps<'/bills/[id]'>) {
  const shop = await requireSessionShop();
  const { id } = await params;

  const bill = await getBill(id);
  if (!bill || bill.shop_id !== shop.id) notFound();

  const awaitingPayment = bill.status === 'created';
  const stockDeducted = Boolean(bill.stock_deducted_at);
  const isCash = bill.payment_method === 'cash';
  // What the customer actually pays: goods plus Razorpay's cut.
  const chargedPaise = bill.total_paise + bill.processing_fee_paise;

  const qrDataUrl =
    awaitingPayment && !isCash && bill.razorpay_payment_link_url
      ? await QRCode.toDataURL(bill.razorpay_payment_link_url, { margin: 1, width: 360 })
      : null;

  const meta = STATUS_META[bill.status];

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to dashboard
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                meta.className,
              )}
            >
              {meta.label}
            </span>
            {isCash ? (
              <span
                title="Paid in cash at the counter. There is no Razorpay payment record behind this bill."
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
              >
                <Banknote className="size-3" aria-hidden />
                cash
              </span>
            ) : bill.simulated ? (
              <SimulatedBadge />
            ) : null}
            {bill.is_seed ? <SeedBadge /> : null}
            <span className="text-xs text-muted-foreground">
              Counter bill · {dateTime(bill.created_at)}
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Bill #{String(bill.bill_number).padStart(4, '0')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {bill.lines.length} {bill.lines.length === 1 ? 'line' : 'lines'} ·{' '}
            {bill.lines.reduce((sum, l) => sum + l.quantity, 0)} items · walk-in customer
          </p>
        </div>

        <p className="text-3xl font-semibold tabular-nums">{rupees(chargedPaise)}</p>
      </header>

      <div className="flex flex-wrap items-start gap-2">
        <BillActions
          billId={bill.id}
          status={bill.status}
          stockDeducted={stockDeducted}
          paymentUrl={bill.razorpay_payment_link_url}
          paymentMethod={bill.payment_method}
          simulatedMode={isSimulated()}
        />
        <CancelBillButton
          billId={bill.id}
          status={bill.status}
          paymentMethod={bill.payment_method}
          totalPaise={chargedPaise}
          stockDeducted={stockDeducted}
        />
      </div>

      {bill.status === 'cancelled' ? (
        <section className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <Ban className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <p className="text-foreground/80">
            <span className="font-semibold text-destructive">Cancelled</span>
            {bill.cancelled_at ? ` on ${dateTime(bill.cancelled_at)}` : ''}
            {bill.cancel_reason ? ` — ${bill.cancel_reason}` : '.'}{' '}
            {bill.razorpay_refund_id
              ? 'The payment was refunded through Razorpay.'
              : 'It no longer counts towards your takings.'}
          </p>
        </section>
      ) : null}

      {bill.status === 'paid' && !stockDeducted ? (
        <section className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          <PackageMinus className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p className="text-foreground/80">
            <span className="font-semibold text-warning">Money in, parts still on the shelf.</span>{' '}
            The customer has paid, but nothing has been deducted from your stock yet — until you hand
            the parts over, they are genuinely still yours, and other shops can still find them in
            search. Tap <span className="font-medium">Cut stock for these items</span> once they leave
            the counter.
          </p>
        </section>
      ) : null}

      {stockDeducted ? (
        <section className="flex items-start gap-3 rounded-lg border border-success/25 bg-success-soft px-4 py-3 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <p className="text-foreground/80">
            <span className="font-semibold text-success">Done.</span> Paid and deducted from stock at{' '}
            {dateTime(bill.stock_deducted_at!)}. This bill is on your dashboard.
          </p>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          {qrDataUrl ? (
            <section className="rounded-xl border bg-card p-4 sm:p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Smartphone className="size-4 text-muted-foreground" aria-hidden />
                Let the customer scan
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                One Razorpay charge for the whole bill. It enters your ledger the moment the payment
                is captured — not before.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-6">
                <Image
                  src={qrDataUrl}
                  alt={`Razorpay payment QR code for ${rupees(chargedPaise)}`}
                  width={180}
                  height={180}
                  unoptimized
                  className="rounded-lg border bg-white p-2"
                />
                <div className="min-w-0 space-y-2">
                  <p className="text-2xl font-semibold tabular-nums">{rupees(chargedPaise)}</p>
                  <a
                    href={bill.razorpay_payment_link_url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block max-w-xs truncate text-xs text-muted-foreground underline"
                  >
                    {bill.razorpay_payment_link_url}
                  </a>
                </div>
              </div>
            </section>
          ) : null}

          <section className="rounded-xl border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold sm:px-5">Items</h2>
            <ul className="divide-y">
              {bill.lines.map((line) => (
                <li
                  key={line.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{line.part_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {line.quantity} × {rupees(line.unit_price_paise)} · {line.category}
                    </p>
                  </div>
                  <p className="text-sm font-medium tabular-nums">{rupees(line.amount_paise)}</p>
                </li>
              ))}
            </ul>
            <div className="space-y-1.5 border-t px-4 py-3 text-sm sm:px-5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Parts</span>
                <span className="tabular-nums">{rupeesPrecise(bill.total_paise)}</span>
              </div>
              {bill.processing_fee_paise > 0 ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Payment processing ({(paymentFeeBps() / 100).toFixed(1)}%)
                  </span>
                  <span className="tabular-nums">+{rupeesPrecise(bill.processing_fee_paise)}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between border-t pt-1.5 font-medium">
                <span>{bill.processing_fee_paise > 0 ? 'Customer pays' : 'Total'}</span>
                <span className="text-lg font-semibold tabular-nums">
                  {rupeesPrecise(chargedPaise)}
                </span>
              </div>
              {bill.processing_fee_paise > 0 ? (
                <p className="pt-1 text-xs text-muted-foreground">
                  The shop keeps {rupeesPrecise(bill.total_paise)} — the surcharge covers what
                  Razorpay deducts, so the listed price is what you actually bank.
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-xl border bg-card p-4 sm:p-5">
            {isCash ? (
              <>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Banknote className="size-4 text-muted-foreground" aria-hidden />
                  Paid in cash
                </h2>
                <p className="mt-2 text-xs text-muted-foreground">
                  Money went straight into the till, so there is{' '}
                  <span className="font-medium">no Razorpay record</span> behind this bill — nothing
                  to look up in the Razorpay dashboard. It still counts as revenue and each line is
                  still its own row in the ledger; the counter board keeps cash and Razorpay
                  takings separate so the numbers stay honest.
                </p>
              </>
            ) : (
              <>
                <h2 className="mb-3 text-sm font-semibold">Razorpay references</h2>
                <RazorpayRefs
                  refs={[
                    { label: 'Order', value: bill.razorpay_order_id },
                    { label: 'Payment link', value: bill.razorpay_payment_link_id },
                    { label: 'Payment', value: bill.razorpay_payment_id },
                    { label: 'Refund', value: bill.razorpay_refund_id },
                  ]}
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  One charge covers every line on this bill. Each line is still its own row in the
                  ledger, so the dashboard can break the month down by part.
                </p>
              </>
            )}
          </section>

          <section className="rounded-xl border bg-card p-4 text-xs text-muted-foreground sm:p-5">
            <h2 className="mb-2 text-sm font-semibold text-foreground">Timestamps</h2>
            <dl className="space-y-1">
              <div className="flex justify-between gap-3">
                <dt>Opened</dt>
                <dd>{dateTime(bill.created_at)}</dd>
              </div>
              {bill.paid_at ? (
                <div className="flex justify-between gap-3">
                  <dt>Paid</dt>
                  <dd>{dateTime(bill.paid_at)}</dd>
                </div>
              ) : null}
              {bill.stock_deducted_at ? (
                <div className="flex justify-between gap-3">
                  <dt>Stock cut</dt>
                  <dd>{dateTime(bill.stock_deducted_at)}</dd>
                </div>
              ) : null}
              {bill.cancelled_at ? (
                <div className="flex justify-between gap-3">
                  <dt>Cancelled</dt>
                  <dd>{dateTime(bill.cancelled_at)}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
