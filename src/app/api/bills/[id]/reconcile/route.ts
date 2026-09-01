import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { getBill } from '@/lib/data/bills';
import { reconcileBillFromRazorpay } from '@/lib/data/fulfilment';

export const dynamic = 'force-dynamic';

/**
 * Asks Razorpay whether the customer actually scanned and paid.
 * The real path is the webhook; this exists because a webhook cannot reach
 * localhost, and reading Razorpay's answer beats guessing locally.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireSessionShopApi();
    const { id } = await ctx.params;

    const bill = await getBill(id);
    if (!bill) throw new Error('Bill not found.');
    if (bill.shop_id !== shop.id) throw new Error('That bill belongs to another shop.');

    const result = await reconcileBillFromRazorpay(id);
    return NextResponse.json(result);
  } catch (err) {
    return apiError(err);
  }
}
