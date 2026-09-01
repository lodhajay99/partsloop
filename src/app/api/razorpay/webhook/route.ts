import { NextResponse } from 'next/server';

import { fulfilBillPayment, fulfilPayment } from '@/lib/data/fulfilment';
import { verifyWebhookSignature } from '@/lib/razorpay/client';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
// Signature verification needs the exact bytes Razorpay signed, so this handler
// reads the raw body itself and never lets a framework re-serialize it.
export const runtime = 'nodejs';

interface WebhookPayload {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; notes?: Record<string, string> } };
    payment_link?: {
      entity?: { id?: string; reference_id?: string; order_id?: string; notes?: Record<string, string> };
    };
    order?: { entity?: { id?: string; notes?: Record<string, string> } };
  };
}

/** Events that mean "money was captured". Everything else is acknowledged and ignored. */
const CAPTURE_EVENTS = new Set(['payment.captured', 'payment_link.paid', 'order.paid']);

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature');

  if (!verifyWebhookSignature(rawBody, signature)) {
    // A bad signature is either a misconfigured secret or someone poking the
    // endpoint. Either way we must not touch the ledger.
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 400 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Malformed webhook body.' }, { status: 400 });
  }

  const event = payload.event ?? 'unknown';
  if (!CAPTURE_EVENTS.has(event)) {
    return NextResponse.json({ ok: true, ignored: event });
  }

  const payment = payload.payload?.payment?.entity;
  const link = payload.payload?.payment_link?.entity;
  const order = payload.payload?.order?.entity;

  const orderId = payment?.order_id ?? link?.order_id ?? order?.id ?? null;

  // A counter bill is one charge over several line items, so it settles at the
  // bill level. Check for it before falling through to the single-transaction path.
  const billId = await resolveBillId({
    fromNotes:
      payment?.notes?.partloop_bill_id ??
      link?.notes?.partloop_bill_id ??
      order?.notes?.partloop_bill_id,
    orderId,
    paymentLinkId: link?.id,
    referenceId: link?.reference_id,
  });

  if (billId) {
    try {
      const result = await fulfilBillPayment({
        billId,
        paymentId: payment?.id ?? null,
        orderId,
        source: 'webhook',
      });
      return NextResponse.json({
        ok: true,
        event,
        bill_id: result.bill.id,
        status: result.bill.status,
        already_processed: result.alreadyProcessed,
        note: result.note,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bill fulfilment failed.';
      console.error('[partloop:webhook]', message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const transactionId = await resolveTransactionId({
    fromNotes:
      payment?.notes?.partloop_transaction_id ??
      link?.notes?.partloop_transaction_id ??
      order?.notes?.partloop_transaction_id ??
      link?.reference_id,
    orderId,
    paymentLinkId: link?.id,
  });

  if (!transactionId) {
    // Acknowledge so Razorpay stops retrying an event we genuinely do not own.
    return NextResponse.json({ ok: true, ignored: 'no matching transaction', event });
  }

  try {
    const result = await fulfilPayment({
      transactionId,
      paymentId: payment?.id ?? null,
      orderId,
      source: 'webhook',
    });

    return NextResponse.json({
      ok: true,
      event,
      transaction_id: result.transaction.id,
      status: result.transaction.status,
      already_processed: result.alreadyProcessed,
      note: result.note,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Fulfilment failed.';
    console.error('[partloop:webhook]', message);
    // 500 so Razorpay retries — fulfilment is idempotent, retries are safe.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Same lookup ladder as resolveTransactionId, for counter bills. `reference_id`
 * on a Payment Link is the bill id, but it is also the transaction id on the
 * inter-shop flow, so a candidate is only accepted if a bill really has it.
 */
async function resolveBillId(input: {
  fromNotes?: string | null;
  orderId?: string | null;
  paymentLinkId?: string | null;
  referenceId?: string | null;
}): Promise<string | null> {
  const db = supabaseAdmin();

  for (const candidate of [input.fromNotes, input.referenceId]) {
    if (!candidate) continue;
    const { data } = await db.from('bills').select('id').eq('id', candidate).maybeSingle();
    if (data) return (data as { id: string }).id;
  }

  if (input.orderId) {
    const { data } = await db
      .from('bills')
      .select('id')
      .eq('razorpay_order_id', input.orderId)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }

  if (input.paymentLinkId) {
    const { data } = await db
      .from('bills')
      .select('id')
      .eq('razorpay_payment_link_id', input.paymentLinkId)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }

  return null;
}

/**
 * Razorpay gives us several possible handles on the same payment. Try the
 * cheapest first (our own id echoed back in notes), then fall back to the
 * order/link ids we stored when the charge was created.
 */
async function resolveTransactionId(input: {
  fromNotes?: string | null;
  orderId?: string | null;
  paymentLinkId?: string | null;
}): Promise<string | null> {
  if (input.fromNotes) return input.fromNotes;

  const db = supabaseAdmin();

  if (input.orderId) {
    const { data } = await db
      .from('transactions')
      .select('id')
      .eq('razorpay_order_id', input.orderId)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }

  if (input.paymentLinkId) {
    const { data } = await db
      .from('transactions')
      .select('id')
      .eq('razorpay_payment_link_id', input.paymentLinkId)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }

  return null;
}
