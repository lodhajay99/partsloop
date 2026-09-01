'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, ExternalLink, HandCoins, Loader2, RefreshCw, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import type { TransactionStatus, TransactionType } from '@/types/db';

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
  simulatedMode,
}: {
  transactionId: string;
  type: TransactionType;
  status: TransactionStatus;
  role: 'buyer' | 'seller';
  paymentUrl: string | null;
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
          payment_url?: string;
          changed?: boolean;
        };
        if (!res.ok) throw new Error(body.error ?? 'That did not work.');

        // The window.open happens after an await, so it is no longer inside the
        // click gesture and popup blockers will often stop it. When that
        // happens, say so — the "Open payment page" button below is already
        // rendering the same link.
        let blocked = false;
        if (body.payment_url) {
          blocked = window.open(body.payment_url, '_blank', 'noopener,noreferrer') === null;
        }

        toast.success(successMessage, {
          description: blocked
            ? 'Your browser blocked the popup — use "Open payment page" below.'
            : body.note,
        });
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

  const isBuyer = role === 'buyer';
  const awaitingPayment = status === 'created' || status === 'reserved';
  const canRelease = isBuyer && type === 'inter_shop_purchase' && (status === 'on_hold' || status === 'paid');

  return (
    <div className="flex flex-wrap gap-2">
      {type === 'inter_shop_purchase' && isBuyer && awaitingPayment ? (
        <Button
          onClick={() =>
            void call('pay', `/api/reservations/${transactionId}/pay`, 'Payment link ready')
          }
          disabled={busy !== null}
        >
          {busy === 'pay' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <CreditCard className="size-4" aria-hidden />
          )}
          {paymentUrl ? 'Reopen payment link' : 'Pay now'}
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
