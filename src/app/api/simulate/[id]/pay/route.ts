import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { fulfilPayment } from '@/lib/data/fulfilment';
import { isSimulated } from '@/lib/razorpay/client';
import { canShopSee, getTransaction } from '@/lib/data/transactions';

export const dynamic = 'force-dynamic';

/**
 * Completes a SIMULATED payment.
 *
 * This exists so the product is walkable with no Razorpay credentials at all —
 * useful for reviewing the app before keys are wired up. It refuses to run the
 * moment real keys are present, so it can never be used to fake a payment that
 * should have gone through Razorpay. Everything it touches is stamped
 * `simulated = true` and rendered with a visible badge.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireSessionShopApi();
    const { id } = await ctx.params;

    if (!isSimulated()) {
      throw new Error(
        'Razorpay keys are configured, so payments must go through Razorpay. ' +
          'Open the payment link and pay with a test card instead.',
      );
    }

    const tx = await getTransaction(id);
    if (!tx) throw new Error('Transaction not found.');
    if (!canShopSee(tx, shop.id)) throw new Error('This transaction is not yours.');

    const result = await fulfilPayment({
      transactionId: id,
      paymentId: `pay_SIM${id.replace(/-/g, '').slice(0, 12)}`,
      source: 'simulator',
    });

    return NextResponse.json({
      transaction: result.transaction,
      already_processed: result.alreadyProcessed,
      note: result.note,
    });
  } catch (err) {
    return apiError(err);
  }
}
