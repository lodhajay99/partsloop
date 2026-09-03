'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { rupees } from '@/lib/format';
import type { BillStatus, PaymentMethod } from '@/types/db';

/**
 * Cancelling a bill.
 *
 * Deliberately two steps. Voiding an unpaid bill is harmless, but cancelling a
 * paid one moves real money and puts stock back on the shelf — not something a
 * mis-tap on a counter tablet should be able to do. The confirmation states
 * exactly what will happen, because "are you sure?" on its own tells nobody
 * anything.
 */
export function CancelBillButton({
  billId,
  status,
  paymentMethod,
  totalPaise,
  stockDeducted,
}: {
  billId: string;
  status: BillStatus;
  paymentMethod: PaymentMethod;
  /** What the customer actually paid, surcharge included. */
  totalPaise: number;
  stockDeducted: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const wasPaid = status === 'paid' || status === 'stocked';
  const isCash = paymentMethod === 'cash';

  const cancel = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/bills/${billId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      const body = (await res.json()) as { error?: string; note?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not cancel the bill.');

      toast.success('Bill cancelled', { description: body.note });
      setConfirming(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel the bill.');
    } finally {
      setBusy(false);
    }
  }, [billId, reason, router]);

  if (status === 'cancelled') return null;

  if (!confirming) {
    return (
      <Button variant="destructive" onClick={() => setConfirming(true)}>
        <Ban className="size-4" aria-hidden />
        Cancel bill
      </Button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="space-y-1.5 text-sm">
        <p className="font-semibold text-destructive">
          {wasPaid ? `Reverse this bill and return ${rupees(totalPaise)}?` : 'Void this bill?'}
        </p>
        <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
          {wasPaid && !isCash ? (
            <li>
              {rupees(totalPaise)} will be refunded through Razorpay — a real API call against the
              original payment.
            </li>
          ) : null}
          {wasPaid && isCash ? (
            <li>
              Nothing to refund automatically — <span className="font-medium">hand the cash back</span>{' '}
              to the customer yourself.
            </li>
          ) : null}
          {stockDeducted ? <li>The parts go back into your stock.</li> : null}
          {!wasPaid ? <li>Nobody paid, so there is no money to return.</li> : null}
          <li>
            The bill stays in your ledger marked cancelled, so the numbering stays intact — it just
            stops counting as takings.
          </li>
        </ul>
      </div>

      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional) — e.g. wrong items, customer changed mind"
        aria-label="Reason for cancelling"
        maxLength={200}
      />

      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" onClick={() => void cancel()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Ban className="size-4" aria-hidden />}
          {wasPaid ? 'Yes, reverse it' : 'Yes, void it'}
        </Button>
        <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
          Keep the bill
        </Button>
      </div>
    </div>
  );
}
