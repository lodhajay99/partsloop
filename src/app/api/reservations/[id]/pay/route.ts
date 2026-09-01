import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { createPaymentForReservation } from '@/lib/data/transactions';

export const dynamic = 'force-dynamic';

/**
 * Creates the Razorpay Order + Payment Link for a reservation, with the Route
 * split attached and the seller's share held. Returns the URL to send the buyer to.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireSessionShopApi();
    const { id } = await ctx.params;

    const result = await createPaymentForReservation(id, shop.id);

    return NextResponse.json({
      transaction: result.transaction,
      payment_url: result.paymentUrl,
      route_simulated: result.routeIsSimulated,
      note: result.note,
    });
  } catch (err) {
    return apiError(err);
  }
}
