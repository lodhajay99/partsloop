import { NextResponse } from 'next/server';

import { apiError, readJson } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { cancelReservation } from '@/lib/data/transactions';

export const dynamic = 'force-dynamic';

interface Body {
  reason?: string;
}

/**
 * Calls off an unpaid reservation.
 *
 * Either side may do it — the seller declining ("already promised to a
 * customer") and the buyer changing their mind are the same operation, and the
 * row records which. Ownership and the paid/unpaid guard are enforced inside
 * cancel_reservation() under a row lock, so two simultaneous presses cannot
 * both succeed.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireSessionShopApi();
    const { id } = await ctx.params;

    const body = await readJson<Body>(req).catch(() => ({}) as Body);
    const reason = body.reason?.trim().slice(0, 200) || undefined;

    const result = await cancelReservation({
      transactionId: id,
      actingShopId: shop.id,
      reason,
    });

    return NextResponse.json({
      transaction: result.transaction,
      previous_status: result.previousStatus,
      cancelled_by_seller: result.cancelledBySeller,
      already_cancelled: result.alreadyCancelled,
      note: result.note,
    });
  } catch (err) {
    return apiError(err);
  }
}
