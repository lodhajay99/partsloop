import Image from 'next/image';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { ArrowLeft, MapPin, Phone, ShieldCheck } from 'lucide-react';

import { SeedBadge, SimulatedBadge, StatusBadge } from '@/components/status-badge';
import { PaymentTimeline } from '@/components/transactions/payment-timeline';
import { RazorpayRefs } from '@/components/transactions/razorpay-refs';
import { TransactionActions } from '@/components/transactions/transaction-actions';
import { requireSessionShop } from '@/lib/auth/session';
import { expireStaleReservations } from '@/lib/data/fulfilment';
import { canShopSee, getTransaction } from '@/lib/data/transactions';
import { dateTime, minutesUntil, rupees, rupeesPrecise } from '@/lib/format';
import { isMockLinkedAccount, isSimulated, platformFeeBps } from '@/lib/razorpay/client';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Transaction · PartLoop' };

export default async function TransactionPage({ params }: PageProps<'/transactions/[id]'>) {
  const shop = await requireSessionShop();
  await expireStaleReservations();

  const { id } = await params;
  const tx = await getTransaction(id);

  if (!tx || !canShopSee(tx, shop.id)) notFound();

  // Counter-bill lines are not standalone sales; the bill is the real document.
  if (tx.bill_id) redirect(`/bills/${tx.bill_id}`);

  const role = tx.buyer_shop_id === shop.id ? 'buyer' : 'seller';
  const isInterShop = tx.type === 'inter_shop_purchase';
  const sellerShare = tx.amount_paise - tx.platform_fee_paise;
  const awaitingPayment = tx.status === 'created' || tx.status === 'reserved';

  // The seller's QR for a walk-in customer to scan at the counter.
  const qrDataUrl =
    tx.type === 'retail_sale' && awaitingPayment && tx.razorpay_payment_link_url
      ? await QRCode.toDataURL(tx.razorpay_payment_link_url, { margin: 1, width: 320 })
      : null;

  const routeSimulated = isSimulated() || isMockLinkedAccount(tx.seller_linked_account_id);

  const razorpayRefs = [
    { label: 'Order', value: tx.razorpay_order_id },
    { label: 'Payment link', value: tx.razorpay_payment_link_id },
    { label: 'Payment', value: tx.razorpay_payment_id },
    { label: 'Route transfer', value: tx.razorpay_transfer_id },
  ];

  return (
    <div className="space-y-6">
      <Link
        href={role === 'buyer' && isInterShop ? '/search' : '/dashboard'}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={tx.status} />
            {tx.is_seed ? <SeedBadge /> : tx.simulated ? <SimulatedBadge /> : null}
            <span className="text-xs text-muted-foreground">
              {isInterShop ? 'Shop-to-shop purchase' : 'Counter sale'} · created {dateTime(tx.created_at)}
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{tx.part_name}</h1>
          <p className="text-sm text-muted-foreground">
            {tx.quantity} × {rupees(Math.round(tx.amount_paise / tx.quantity))}
            {isInterShop
              ? role === 'buyer'
                ? ` · from ${tx.seller_name}`
                : ` · to ${tx.buyer_name}`
              : ' · walk-in customer'}
          </p>
        </div>

        <p className="text-3xl font-semibold tabular-nums">{rupees(tx.amount_paise)}</p>
      </header>

      {tx.status === 'reserved' && tx.hold_until ? (
        <p className="rounded-lg border border-info/25 bg-info-soft px-4 py-3 text-sm">
          Held for you for another{' '}
          <span className="font-semibold">{minutesUntil(tx.hold_until)} minutes</span>. After that the
          reservation expires and the stock goes back to the open pool.
        </p>
      ) : null}

      {tx.status === 'expired' ? (
        <p className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
          This reservation expired before it was paid.{' '}
          <Link href="/search" className="underline">
            Search again
          </Link>{' '}
          to re-reserve.
        </p>
      ) : null}

      <TransactionActions
        transactionId={tx.id}
        type={tx.type}
        status={tx.status}
        role={role}
        paymentUrl={tx.razorpay_payment_link_url}
        simulatedMode={isSimulated()}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          {qrDataUrl ? (
            <section className="rounded-xl border bg-card p-4 sm:p-5">
              <h2 className="text-sm font-semibold">Take the payment</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Show this to the customer. The sale enters your ledger the moment Razorpay captures
                the payment — not before.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-5">
                <Image
                  src={qrDataUrl}
                  alt="Razorpay payment link QR code"
                  width={160}
                  height={160}
                  unoptimized
                  className="rounded-lg border bg-white p-2"
                />
                <div className="min-w-0 space-y-2 text-sm">
                  <p className="font-medium">{rupees(tx.amount_paise)}</p>
                  <a
                    href={tx.razorpay_payment_link_url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-xs text-muted-foreground underline"
                  >
                    {tx.razorpay_payment_link_url}
                  </a>
                </div>
              </div>
            </section>
          ) : null}

          {isInterShop ? (
            <section className="rounded-xl border bg-card p-4 sm:p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
                How the money splits
              </h2>

              <dl className="mt-3 space-y-2 text-sm">
                {/* Exact paise here, not rounded rupees: these three lines are a
                    subtraction the reader can check, and rounding each one
                    independently makes it stop adding up (₹1,772 − ₹35 = ₹1,736
                    reads as an error even though the paise are right). */}
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Buyer pays</dt>
                  <dd className="tabular-nums">{rupeesPrecise(tx.amount_paise)}</dd>
                </div>
                {/* With no platform fee there is nothing to subtract, and a
                    "−₹0.00" line is just noise pretending to be arithmetic. */}
                {tx.platform_fee_paise > 0 ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">
                      Platform fee ({(platformFeeBps() / 100).toFixed(1)}%)
                    </dt>
                    <dd className="tabular-nums">−{rupeesPrecise(tx.platform_fee_paise)}</dd>
                  </div>
                ) : (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Platform fee</dt>
                    <dd className="text-muted-foreground">none — PartLoop takes no cut</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4 border-t pt-2 font-medium">
                  <dt>Route transfer to {tx.seller_name}</dt>
                  <dd className="tabular-nums">{rupeesPrecise(sellerShare)}</dd>
                </div>
              </dl>

              <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
                {routeSimulated ? (
                  <>
                    <span className="font-medium text-warning">Simulated Route split.</span>{' '}
                    {isSimulated()
                      ? 'No Razorpay keys are configured in this deployment.'
                      : `The seller's Linked Account id is a mock (${tx.seller_linked_account_id ?? 'none'}); real Route onboarding needs KYC we skipped for the hackathon.`}{' '}
                      The split arithmetic, the hold and the release all run — they just do not reach
                      Razorpay.
                  </>
                ) : (
                  <>
                    <span className="font-medium">Live Route transfer.</span> The seller&apos;s share
                    is transferred to Linked Account{' '}
                    <code className="font-mono">{tx.seller_linked_account_id}</code> and held with
                    Razorpay&apos;s Settlement Hold API until the buyer marks the part received. This
                    is escrow-<em>like</em>, not licensed escrow.
                  </>
                )}
              </p>
            </section>
          ) : null}

          {isInterShop && role === 'buyer' && tx.status !== 'expired' ? (
            <section className="rounded-xl border bg-card p-4 sm:p-5">
              <h2 className="text-sm font-semibold">Pick it up from</h2>
              <p className="mt-2 font-medium">{tx.seller_name}</p>
              {tx.seller_address ? (
                <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {tx.seller_address}
                </p>
              ) : null}
              {tx.seller_phone ? (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Phone className="size-3.5 shrink-0" aria-hidden />
                  <a href={`tel:${tx.seller_phone}`} className="hover:underline">
                    {tx.seller_phone}
                  </a>
                </p>
              ) : null}
            </section>
          ) : null}
        </div>

        <aside className="space-y-5">
          <section className="rounded-xl border bg-card p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold">Progress</h2>
            <PaymentTimeline type={tx.type} status={tx.status} />
          </section>

          <section className="rounded-xl border bg-card p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold">Razorpay references</h2>
            <RazorpayRefs refs={razorpayRefs} />
            {/* Keyed off "is anything shown", not off the order id — paying
                through the simulator produces payment and transfer ids without
                ever creating an order. */}
            {razorpayRefs.every((r) => !r.value) ? (
              <p className="text-xs text-muted-foreground">
                No Razorpay records yet — they appear once you start the payment.
              </p>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                Paste any of these into the Razorpay test dashboard to see the same record from the
                other side.
              </p>
            )}
          </section>

          <section className="rounded-xl border bg-card p-4 text-xs text-muted-foreground sm:p-5">
            <h2 className="mb-2 text-sm font-semibold text-foreground">Timestamps</h2>
            <dl className="space-y-1">
              <div className="flex justify-between gap-3">
                <dt>Created</dt>
                <dd>{dateTime(tx.created_at)}</dd>
              </div>
              {tx.paid_at ? (
                <div className="flex justify-between gap-3">
                  <dt>Paid</dt>
                  <dd>{dateTime(tx.paid_at)}</dd>
                </div>
              ) : null}
              {tx.released_at ? (
                <div className="flex justify-between gap-3">
                  <dt>Released</dt>
                  <dd>{dateTime(tx.released_at)}</dd>
                </div>
              ) : null}
              {tx.hold_until ? (
                <div className="flex justify-between gap-3">
                  <dt>Reservation expires</dt>
                  <dd>{dateTime(tx.hold_until)}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
