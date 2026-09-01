import { NextResponse } from 'next/server';

import { apiError, readJson } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { removeInventoryLine, upsertInventoryLine } from '@/lib/data/inventory';

export const dynamic = 'force-dynamic';

interface UpsertBody {
  part_id?: string;
  quantity?: number;
  price_paise?: number;
}

/** Add or update one stock line. Always scoped to the session shop. */
export async function PUT(req: Request) {
  try {
    const shop = await requireSessionShopApi();
    const body = await readJson<UpsertBody>(req);

    if (!body.part_id) throw new Error('part_id is required.');
    if (body.quantity === undefined || body.quantity < 0) throw new Error('A quantity of 0 or more is required.');
    if (!body.price_paise || body.price_paise <= 0) throw new Error('A price above zero is required.');

    const line = await upsertInventoryLine({
      shopId: shop.id,
      partId: body.part_id,
      quantity: body.quantity,
      pricePaise: body.price_paise,
    });

    return NextResponse.json({ line });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const shop = await requireSessionShopApi();
    const partId = new URL(req.url).searchParams.get('part_id');
    if (!partId) throw new Error('part_id is required.');

    await removeInventoryLine(shop.id, partId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
