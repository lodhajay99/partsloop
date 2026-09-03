'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Smartphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { openCheckout } from '@/lib/razorpay/checkout-browser';
import type { CheckoutHandle } from '@/types/db';

/**
 * The customer-facing pay button.
 *
 * No session and no shop context — this runs on a stranger's phone. It cannot
 * mark anything paid; it opens Razorpay, and the shop's own screen confirms the
 * capture with Razorpay from the server. The worst a hostile visitor can do
 * here is pay someone else's bill.
 */
export function PublicCheckout({
  handle,
  shopName,
  description,
}: {
  handle: CheckoutHandle;
  shopName: string;
  description: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pay = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await openCheckout({ handle, name: shopName, description });
      if (outcome.paid) {
        setMessage('Payment sent. The shop will see it on their screen.');
        router.refresh();
      } else if (outcome.error) {
        setMessage(outcome.error);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not open Razorpay.');
    } finally {
      setBusy(false);
    }
  }, [handle, shopName, description, router]);

  return (
    <div className="space-y-3">
      <Button className="w-full" size="lg" onClick={() => void pay()} disabled={busy}>
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Smartphone className="size-4" aria-hidden />
        )}
        Pay with UPI or card
      </Button>
      {message ? <p className="text-center text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}
