'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CreditCard, ExternalLink, Loader2, PackageMinus, Plus, RefreshCw, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { openCheckout } from '@/lib/razorpay/checkout-browser';
import type { BillStatus, CheckoutHandle, PaymentMethod } from '@/types/db';

/**
 * What the shopkeeper can do with a bill, by state.
 *
 * Before payment: open the link, or ask Razorpay whether the customer has paid.
 * After payment: the two things that actually happen next at a counter —
 * take the sold parts off the shelf, and start the next customer's bill.
 *
 * A cash bill skips straight to the second group: the money was in the till
 * before the bill existed, so there is nothing to wait for.
 */
export function BillActions({
  billId,
  status,
  stockDeducted,
  paymentUrl,
  checkout,
  shopName,
  paymentMethod,
  simulatedMode,
}: {
  billId: string;
  status: BillStatus;
  stockDeducted: boolean;
  paymentUrl: string | null;
  checkout: CheckoutHandle | null;
  shopName: string;
  paymentMethod: PaymentMethod;
  /** True when the app has no Razorpay keys at all. */
  simulatedMode: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const call = useCallback(
    async (key: string, url: string, successMessage: string) => {
      setBusy(key);
      try {
        const res = await fetch(url, { method: 'POST' });
        const body = (await res.json()) as { error?: string; note?: string };
        if (!res.ok) throw new Error(body.error ?? 'That did not work.');

        toast.success(successMessage, { description: body.note });
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'That did not work.');
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  /**
   * Take the payment on the shop's own screen — the customer taps UPI and scans
   * from the counter, or the shopkeeper turns the monitor round. Razorpay's own
   * answer, fetched server-side, is what actually marks the bill paid.
   */
  const takePayment = useCallback(async () => {
    if (!checkout) return;
    setBusy('checkout');
    try {
      const outcome = await openCheckout({
        handle: checkout,
        name: shopName,
        description: `Counter bill at ${shopName}`,
      });
      if (outcome.error) {
        toast.error(outcome.error);
        return;
      }
      if (outcome.dismissed) {
        toast.info('Payment closed', { description: 'Nothing was charged.' });
        return;
      }
      await call('reconcile', `/api/bills/${billId}/reconcile`, 'Payment confirmed with Razorpay');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Razorpay Checkout could not open.');
    } finally {
      setBusy(null);
    }
  }, [checkout, shopName, billId, call]);

  // A cash bill is paid the moment it is written, so none of the "is the
  // customer done paying yet" actions apply to it.
  const awaitingPayment = status === 'created' && paymentMethod !== 'cash';

  return (
    <div className="flex flex-wrap gap-2">
      {awaitingPayment && checkout ? (
        <Button onClick={() => void takePayment()} disabled={busy !== null}>
          {busy === 'checkout' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <CreditCard className="size-4" aria-hidden />
          )}
          Take payment
        </Button>
      ) : null}

      {awaitingPayment && paymentUrl && !simulatedMode ? (
        <Button
          render={<a href={paymentUrl} target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
          variant="outline"
        >
          <ExternalLink className="size-4" aria-hidden />
          Open customer page
        </Button>
      ) : null}

      {awaitingPayment && !simulatedMode ? (
        <Button
          variant="outline"
          onClick={() => void call('reconcile', `/api/bills/${billId}/reconcile`, 'Checked with Razorpay')}
          disabled={busy !== null}
        >
          {busy === 'reconcile' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          Customer paid — check Razorpay
        </Button>
      ) : null}

      {awaitingPayment && simulatedMode ? (
        <Button
          variant="outline"
          onClick={() =>
            void call('simulate', `/api/simulate/bill/${billId}/pay`, 'Simulated payment captured')
          }
          disabled={busy !== null}
        >
          {busy === 'simulate' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Zap className="size-4" aria-hidden />
          )}
          Simulate the customer scanning
        </Button>
      ) : null}

      {status === 'paid' && !stockDeducted ? (
        <Button
          onClick={() =>
            void call('deduct', `/api/bills/${billId}/deduct-stock`, 'Stock updated')
          }
          disabled={busy !== null}
        >
          {busy === 'deduct' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <PackageMinus className="size-4" aria-hidden />
          )}
          Cut stock for these items
        </Button>
      ) : null}

      {!awaitingPayment ? (
        <Button
          render={<Link href="/sales/new" />}
          nativeButton={false}
          variant={stockDeducted ? 'default' : 'outline'}
        >
          <Plus className="size-4" aria-hidden />
          New bill
        </Button>
      ) : null}
    </div>
  );
}
