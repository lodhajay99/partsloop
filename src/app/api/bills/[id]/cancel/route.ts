import { NextResponse } from 'next/server';

import { apiError, readJson } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { cancelBill } from '@/lib/data/bills';

export const dynamic = 'force-dynamic';

interface Body {
  reason?: string;
}

/**
 * Cancels a bill: voids it if nobody paid, reverses it if somebody did.
 *
 * Refunding happens before the ledger is touched, so a refund that fails leaves
 * the bill open rather than producing books that claim money went back when it
 * did not. Idempotent — cancelling twice reports the first outcome.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireSessionShopApi();
    const { id } = await ctx.params;

    const body = await readJson<Body>(req).catch(() => ({}) as Body);
    const reason = body.reason?.trim().slice(0, 200) || undefined;

    const result = await cancelBill({ billId: id, shopId: shop.id, reason });

    return NextResponse.json({
      bill: result.bill,
      already_cancelled: result.alreadyCancelled,
      previous_status: result.previousStatus,
      stock_restored: result.stockRestored,
      refund_id: result.refundId,
      note: result.note,
    });
  } catch (err) {
    return apiError(err);
  }
}
