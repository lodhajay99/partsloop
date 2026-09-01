import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { releaseHold } from '@/lib/data/fulfilment';

export const dynamic = 'force-dynamic';

/**
 * "Mark received" — the buyer confirms handoff, so Razorpay releases the
 * settlement hold on the seller's Route transfer.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireSessionShopApi();
    const { id } = await ctx.params;

    const result = await releaseHold(id, shop.id);

    return NextResponse.json({
      transaction: result.transaction,
      simulated: result.simulated,
      note: result.note,
    });
  } catch (err) {
    return apiError(err);
  }
}
