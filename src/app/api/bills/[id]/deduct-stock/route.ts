import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { deductBillStock, getBill } from '@/lib/data/bills';

export const dynamic = 'force-dynamic';

/**
 * "Cut the stock" — the parts on this bill have physically left the counter.
 *
 * Separate from payment on purpose: a paid bill whose goods are still on the
 * shelf is a real state, and pretending otherwise is how the ledger and the
 * shelf drift apart. Idempotent, so a double tap is harmless.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireSessionShopApi();
    const { id } = await ctx.params;

    const bill = await getBill(id);
    if (!bill) throw new Error('Bill not found.');
    if (bill.shop_id !== shop.id) throw new Error('That bill belongs to another shop.');

    const result = await deductBillStock(id, shop.id);
    const updated = await getBill(id);

    return NextResponse.json({
      bill: updated,
      lines_deducted: result.linesDeducted,
      already_done: result.alreadyDone,
      note: result.alreadyDone
        ? 'Stock was already taken off the shelf for this bill.'
        : `Stock updated for ${result.linesDeducted} ${result.linesDeducted === 1 ? 'part' : 'parts'}.`,
    });
  } catch (err) {
    return apiError(err);
  }
}
