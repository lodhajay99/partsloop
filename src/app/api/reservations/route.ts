import { NextResponse } from 'next/server';

import { apiError, readJson } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { createReservation } from '@/lib/data/transactions';

export const dynamic = 'force-dynamic';

interface Body {
  inventory_id?: string;
  quantity?: number;
}

/**
 * Reserve stock at another shop.
 *
 * The client sends the opaque `inventory_id` from the search results, never a
 * shop id — it does not have one. Search masks the seller until a reservation
 * exists, so the browser must not need to know who it is reserving from in
 * order to reserve. The server resolves seller and part from the row.
 *
 * This is also the moment identity is revealed, so it deliberately creates a
 * durable ledger record rather than flipping a UI toggle.
 */
export async function POST(req: Request) {
  try {
    const shop = await requireSessionShopApi();
    const body = await readJson<Body>(req);

    if (!body.inventory_id) throw new Error('inventory_id is required.');

    const transaction = await createReservation({
      buyerShop: shop,
      inventoryId: body.inventory_id,
      quantity: body.quantity ?? 1,
    });

    return NextResponse.json({ transaction });
  } catch (err) {
    return apiError(err);
  }
}
