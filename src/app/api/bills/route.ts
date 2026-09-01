import { NextResponse } from 'next/server';

import { apiError, readJson } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { createBill, type BillDraftLine } from '@/lib/data/bills';
import type { PaymentMethod } from '@/types/db';

export const dynamic = 'force-dynamic';

interface Body {
  lines?: BillDraftLine[];
  payment_method?: PaymentMethod;
}

/**
 * Opens a counter bill.
 *
 * `payment_method: 'razorpay'` (the default) charges the total and returns a
 * payment link to show as a QR. `'cash'` records money already taken and cuts
 * stock in the same call.
 *
 * The cart is built in the browser and posted here in one go — an abandoned
 * bill should not leave a row behind. Prices and stock are re-checked server
 * side against the shop's own inventory; the client's numbers are a proposal,
 * not the truth.
 */
export async function POST(req: Request) {
  try {
    const shop = await requireSessionShopApi();
    const body = await readJson<Body>(req);

    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      throw new Error('Add at least one item to the bill.');
    }

    if (body.payment_method && !['razorpay', 'cash'].includes(body.payment_method)) {
      throw new Error('payment_method must be "razorpay" or "cash".');
    }

    const result = await createBill({
      shop,
      lines: body.lines,
      paymentMethod: body.payment_method,
    });

    return NextResponse.json({
      bill: result.bill,
      payment_url: result.paymentUrl,
      stock_cut: result.stockCut,
      note: result.note,
    });
  } catch (err) {
    return apiError(err);
  }
}
