import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { getBill } from '@/lib/data/bills';
import { fulfilBillPayment } from '@/lib/data/fulfilment';
import { isSimulated } from '@/lib/razorpay/client';

export const dynamic = 'force-dynamic';

/**
 * Stands in for the customer scanning the QR and paying, when the deployment
 * has no Razorpay keys at all. Refuses to run once real keys are present, so it
 * can never fake a payment that should have gone through Razorpay.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireSessionShopApi();
    const { id } = await ctx.params;

    if (!isSimulated()) {
      throw new Error(
        'Razorpay keys are configured, so the customer must actually pay the link. ' +
          'Use "Check Razorpay" once they have.',
      );
    }

    const bill = await getBill(id);
    if (!bill) throw new Error('Bill not found.');
    if (bill.shop_id !== shop.id) throw new Error('That bill belongs to another shop.');

    const result = await fulfilBillPayment({
      billId: id,
      paymentId: `pay_SIM${id.replace(/-/g, '').slice(0, 12)}`,
      source: 'simulator',
    });

    return NextResponse.json({
      bill: result.bill,
      already_processed: result.alreadyProcessed,
      note: result.note,
    });
  } catch (err) {
    return apiError(err);
  }
}
