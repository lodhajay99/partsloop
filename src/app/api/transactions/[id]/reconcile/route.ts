import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { reconcileFromRazorpay } from '@/lib/data/fulfilment';
import { canShopSee, getTransaction } from '@/lib/data/transactions';

export const dynamic = 'force-dynamic';

/**
 * Asks Razorpay whether this transaction's Payment Link was actually paid, and
 * fulfils it if so.
 *
 * Webhooks are the real path, but a webhook cannot reach localhost without a
 * tunnel. This endpoint reads the truth from Razorpay's API instead of guessing
 * locally, so the demo works either way and never invents a payment.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireSessionShopApi();
    const { id } = await ctx.params;

    const tx = await getTransaction(id);
    if (!tx) throw new Error('Transaction not found.');
    if (!canShopSee(tx, shop.id)) throw new Error('This transaction is not yours.');

    const result = await reconcileFromRazorpay(id);
    return NextResponse.json(result);
  } catch (err) {
    return apiError(err);
  }
}
