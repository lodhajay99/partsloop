'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, ExternalLink, HandCoins, Loader2, RefreshCw, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { openCheckout } from '@/lib/razorpay/checkout-browser';
import type { CheckoutHandle, TransactionStatus, TransactionType } from '@/types/db';

/**
 * The buyer/seller action bar. Every button here maps to exactly one Razorpay
 * call, and the note the server returns is surfaced verbatim — including when
 * a call had to fall back to simulation.
 */
export function TransactionActions({
  transactionId,
  type,
  status,
  role,
  paymentUrl,
  partName,
  sellerName,
  simulatedMode,
}: {
  transactionId: string;
  type: TransactionType;
  status: TransactionStatus;
  role: 'buyer' | 'seller';
  paymentUrl: string | null;
  partName: string;
  sellerName: string;
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
        const body = (await res.json()) as {
          error?: string;
          note?: string;
          payment_url?: string | null;
          checkout?: CheckoutHandle | null;
          changed?: boolean;
        };
        if (!res.ok) throw new Error(body.error ?? 'That did not work.');

        toast.success(successMessage, { description: body.note });
        router.refresh();
        return body;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'That did not work.');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  /**
   * Start the payment, then hand the buyer straight to Razorpay Checkout.
   *
   * Checkout opens in the page rather than a new tab, so there is no popup for
   * a browser to block. When it reports success we do not believe it — we ask
   * our own server to confirm the capture with Razorpay before anything moves.
   */
  const payNow = useCallback(async () => {
    const body = await call('pay', `/api/reservations/${transactionId}/pay`, 'Payment started');
    if (!body) return;

    if (!body.checkout) {
      // Simulated mode, or an older row with only a link. Fall back to the URL.
      if (body.payment_url) window.open(body.payment_url, '_blank', 'noopener,noreferrer');
      return;
    }

    setBusy('pay');
    try {
      const outcome = await openCheckout({
        handle: body.checkout,
        name: 'PartLoop',
        description: `${partName} from ${sellerName}`,
      });

      if (outcome.error) {
        toast.error(outcome.error);
        return;
      }
      if (outcome.dismissed) {
        toast.info('Payment closed', {
          description: 'Nothing was charged. "Pay now" picks up where you left off.',
        });
        return;
      }

      await call(
        'reconcile',
        `/api/transactions/${transactionId}/reconcile`,
        'Payment confirmed with Razorpay',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Razorpay Checkout could not open.');
    } finally {
      setBusy(null);
    }
  }, [call, transactionId, partName, sellerName]);

  const isBuyer = role === 'buyer';
  const awaitingPayment = status === 'created' || status === 'reserved';
  const canRelease = isBuyer && type === 'inter_shop_purchase' && (status === 'on_hold' || status === 'paid');

  return (
    <div className="flex flex-wrap gap-2">
      {type === 'inter_shop_purchase' && isBuyer && awaitingPayment ? (
        <Button
          onClick={() => void payNow()}
          disabled={busy !== null}
        >
          {busy === 'pay' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <CreditCard className="size-4" aria-hidden />
          )}
          Pay now
        </Button>
      ) : null}

      {paymentUrl && awaitingPayment ? (
        <Button
          render={<a href={paymentUrl} target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
          variant="outline"
        >
          <ExternalLink className="size-4" aria-hidden />
          Open payment page
        </Button>
      ) : null}

      {awaitingPayment && !simulatedMode ? (
        <Button
          variant="outline"
          onClick={() =>
            void call(
              'reconcile',
              `/api/transactions/${transactionId}/reconcile`,
              'Checked with Razorpay',
            )
          }
          disabled={busy !== null}
        >
          {busy === 'reconcile' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          I&apos;ve paid — check Razorpay
        </Button>
      ) : null}

      {awaitingPayment && simulatedMode ? (
        <Button
          variant="outline"
          onClick={() =>
            void call('simulate', `/api/simulate/${transactionId}/pay`, 'Simulated payment captured')
          }
          disabled={busy !== null}
        >
          {busy === 'simulate' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Zap className="size-4" aria-hidden />
          )}
          Complete simulated payment
        </Button>
      ) : null}

      {canRelease ? (
        <Button
          onClick={() =>
            void call(
              'release',
              `/api/reservations/${transactionId}/release`,
              'Settlement hold released',
            )
          }
          disabled={busy !== null}
        >
          {busy === 'release' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <HandCoins className="size-4" aria-hidden />
          )}
          Mark received &amp; release payment
        </Button>
      ) : null}
    </div>
  );
}
