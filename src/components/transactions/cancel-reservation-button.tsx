'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { TransactionStatus } from '@/types/db';

/**
 * Calling off an unpaid reservation.
 *
 * The same action reads differently depending on which side you are: the seller
 * is declining to supply, the buyer is withdrawing. Labelling both "cancel"
 * would leave the shopkeeper unsure whether they are refusing a sale or
 * abandoning a purchase, so the wording follows the role.
 *
 * The reason is worth more than it looks. A buyer who drove across Pune deserves
 * "already sold to a walk-in" rather than a row that silently disappears.
 */
export function CancelReservationButton({
  transactionId,
  status,
  role,
  counterpartyName,
}: {
  transactionId: string;
  status: TransactionStatus;
  role: 'buyer' | 'seller';
  counterpartyName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const isSeller = role === 'seller';

  const cancel = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/reservations/${transactionId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      const body = (await res.json()) as { error?: string; note?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not call this off.');

      toast.success(isSeller ? 'Reservation declined' : 'Reservation cancelled', {
        description: body.note,
      });
      setConfirming(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not call this off.');
    } finally {
      setBusy(false);
    }
  }, [transactionId, reason, isSeller, router]);

  // Only an unpaid reservation can simply be called off; once money is captured
  // the seller's share is under a settlement hold and unwinding it is a refund.
  if (status !== 'reserved' && status !== 'created') return null;

  if (!confirming) {
    return (
      <Button variant="destructive" onClick={() => setConfirming(true)}>
        <Ban className="size-4" aria-hidden />
        {isSeller ? 'Decline this reservation' : 'Cancel my reservation'}
      </Button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="space-y-1.5 text-sm">
        <p className="font-semibold text-destructive">
          {isSeller
            ? `Tell ${counterpartyName} you cannot supply this?`
            : 'Cancel this reservation?'}
        </p>
        <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
          <li>Nothing has been charged, so there is no money to return.</li>
          <li>Your stock is untouched — a reservation never took it off the shelf.</li>
          {isSeller ? (
            <li>The part goes straight back into open search for other shops.</li>
          ) : (
            <li>The seller is free to sell it to someone else.</li>
          )}
        </ul>
      </div>

      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={
          isSeller
            ? 'Reason (optional) — e.g. already promised to a customer'
            : 'Reason (optional) — e.g. found it closer'
        }
        aria-label="Reason for calling this off"
        maxLength={200}
      />

      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" onClick={() => void cancel()} disabled={busy}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Ban className="size-4" aria-hidden />
          )}
          {isSeller ? 'Yes, decline it' : 'Yes, cancel it'}
        </Button>
        <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
          Keep it
        </Button>
      </div>
    </div>
  );
}
