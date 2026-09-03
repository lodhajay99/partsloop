import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';

import { TransactionActions } from '@/components/transactions/transaction-actions';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { requireSessionShop } from '@/lib/auth/session';
import { canShopSee, getTransaction } from '@/lib/data/transactions';
import { rupees } from '@/lib/format';
import { isSimulated } from '@/lib/razorpay/client';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Simulated payment · PartLoop' };

/**
 * Stand-in for a Razorpay hosted payment page, used only when the deployment
 * has no Razorpay keys. With keys present this page redirects to the real
 * transaction view — it must never be a way to fake a payment that should have
 * gone through Razorpay.
 */
export default async function SimulatePayPage({ params }: PageProps<'/simulate/pay/[id]'>) {
  const shop = await requireSessionShop();
  const { id } = await params;

  if (!isSimulated()) redirect(`/transactions/${id}`);

  const tx = await getTransaction(id);
  if (!tx || !canShopSee(tx, shop.id)) notFound();

  const settled = !['created', 'reserved'].includes(tx.status);

  return (
    <div className="mx-auto max-w-lg space-y-5 py-6">
      <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <p>
          <span className="font-semibold text-warning">This is not Razorpay.</span> No API keys are
          configured, so this page stands in for the hosted checkout. Nothing here charges anyone.
        </p>
      </div>

      <div className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Paying</p>
          <StatusBadge status={tx.status} />
        </div>

        <div>
          <p className="text-3xl font-semibold tabular-nums">{rupees(tx.amount_paise)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {tx.quantity} × {tx.part_name}
            {tx.type === 'inter_shop_purchase' ? ` from ${tx.seller_name}` : ''}
          </p>
        </div>

        {settled ? (
          <Button
            render={<Link href={`/transactions/${tx.id}`} />}
            nativeButton={false}
            className="w-full"
          >
            Already paid — see the transaction
          </Button>
        ) : (
          <TransactionActions
            transactionId={tx.id}
            type={tx.type}
            status={tx.status}
            role={tx.buyer_shop_id === shop.id ? 'buyer' : 'seller'}
            paymentUrl={null}
          partName={tx.part_name}
          sellerName={tx.seller_name}
            simulatedMode
          />
        )}
      </div>

      <Link
        href={`/transactions/${tx.id}`}
        className="block text-center text-sm text-muted-foreground hover:text-foreground"
      >
        Back to the transaction
      </Link>
    </div>
  );
}
