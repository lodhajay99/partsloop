import { notFound } from 'next/navigation';

import { PublicCheckout } from '@/components/sales/public-checkout';
import { getBill } from '@/lib/data/bills';
import { checkoutHandle } from '@/lib/razorpay/client';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rupees } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * The page a walk-in customer lands on after scanning the counter QR.
 *
 * Deliberately outside the app shell and outside the shop session: whoever is
 * standing at the counter is not signed in and never will be. It exposes only
 * what is already printed on the bill they are holding — shop, amount, item
 * count — and the Razorpay key id, which is public by design.
 */
export default async function PublicPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bill = await getBill(id);
  if (!bill || bill.payment_method === 'cash') notFound();

  const { data: shopRow } = await supabaseAdmin()
    .from('shops')
    .select('name')
    .eq('id', bill.shop_id)
    .maybeSingle();
  const shopName = (shopRow as { name: string } | null)?.name ?? 'this shop';

  const chargedPaise = bill.total_paise + bill.processing_fee_paise;
  const settled = bill.status === 'paid' || bill.status === 'stocked';
  const handle = settled ? null : checkoutHandle(bill.razorpay_order_id, chargedPaise);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 p-6">
      <div className="space-y-1 text-center">
        <p className="text-sm text-muted-foreground">Pay {shopName}</p>
        <p className="text-4xl font-semibold tabular-nums">{rupees(chargedPaise)}</p>
        <p className="text-sm text-muted-foreground">
          Bill #{String(bill.bill_number).padStart(4, '0')} · {bill.lines.length}{' '}
          {bill.lines.length === 1 ? 'item' : 'items'}
        </p>
      </div>

      {bill.status === 'cancelled' ? (
        <p className="rounded-lg border bg-card p-4 text-center text-sm text-muted-foreground">
          This bill was cancelled. Nothing is owed — please ask the shop for a new one.
        </p>
      ) : settled ? (
        <p className="rounded-lg border bg-card p-4 text-center text-sm font-medium text-emerald-600">
          Paid. Thank you.
        </p>
      ) : handle ? (
        <PublicCheckout
          handle={handle}
          shopName={shopName}
          description={`${bill.lines.length} ${bill.lines.length === 1 ? 'item' : 'items'} at ${shopName}`}
        />
      ) : (
        <p className="rounded-lg border bg-card p-4 text-center text-sm text-muted-foreground">
          This bill has no live Razorpay payment attached. Please pay at the counter.
        </p>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Payments are handled by Razorpay in test mode. PartLoop never sees your card or UPI details.
      </p>
    </main>
  );
}
