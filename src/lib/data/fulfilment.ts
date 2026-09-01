import 'server-only';

import {
  createPaymentTransfer,
  fetchPaymentLink,
  fetchPaymentTransfers,
  isMockLinkedAccount,
  isSimulated,
  setTransferHold,
  type RouteTransferSpec,
} from '@/lib/razorpay/client';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Bill, Shop, Transaction } from '@/types/db';

/**
 * What happens after money moves.
 *
 * Three different entry points converge here, and they must all do exactly the
 * same thing:
 *   1. POST /api/razorpay/webhook   — the real path (payment.captured)
 *   2. POST /api/transactions/:id/reconcile — polls Razorpay for link status,
 *      so the demo works on localhost where no webhook can reach us
 *   3. POST /api/simulate/:id/pay   — simulated mode, no Razorpay keys at all
 *
 * Everything here is idempotent. A webhook that fires twice, or a webhook that
 * races the reconcile poll, must not decrement stock twice.
 */

const TERMINAL_PAID: ReadonlySet<string> = new Set([
  'paid',
  'on_hold',
  'released',
  'completed',
  'refunded',
]);

export interface FulfilResult {
  transaction: Transaction;
  alreadyProcessed: boolean;
  transferId: string | null;
  simulated: boolean;
  note: string;
}

/**
 * Marks a transaction paid, decrements the seller's stock, and — for a
 * shop-to-shop purchase — puts the seller's share of the money on hold.
 */
export async function fulfilPayment(input: {
  transactionId: string;
  paymentId?: string | null;
  orderId?: string | null;
  source: 'webhook' | 'reconcile' | 'simulator';
}): Promise<FulfilResult> {
  const db = supabaseAdmin();

  const { data: txRow, error } = await db
    .from('transactions')
    .select('*')
    .eq('id', input.transactionId)
    .maybeSingle();

  if (error) throw new Error(`Could not load transaction: ${error.message}`);
  if (!txRow) throw new Error(`Transaction ${input.transactionId} not found.`);

  const tx = txRow as Transaction;

  // Idempotency gate. Still backfill payment ids if the first writer lacked them.
  if (TERMINAL_PAID.has(tx.status)) {
    if ((input.paymentId && !tx.razorpay_payment_id) || (input.orderId && !tx.razorpay_order_id)) {
      const { data: patched } = await db
        .from('transactions')
        .update({
          razorpay_payment_id: tx.razorpay_payment_id ?? input.paymentId ?? null,
          razorpay_order_id: tx.razorpay_order_id ?? input.orderId ?? null,
        })
        .eq('id', tx.id)
        .select('*')
        .single();

      return {
        transaction: (patched ?? tx) as Transaction,
        alreadyProcessed: true,
        transferId: tx.razorpay_transfer_id,
        simulated: tx.simulated,
        note: 'Already settled; backfilled Razorpay ids.',
      };
    }

    return {
      transaction: tx,
      alreadyProcessed: true,
      transferId: tx.razorpay_transfer_id,
      simulated: tx.simulated,
      note: `Already processed (status ${tx.status}).`,
    };
  }

  if (tx.status === 'expired') {
    throw new Error('This reservation expired before payment was captured.');
  }

  // Stock leaves the seller's shelf exactly once, at capture.
  const { error: stockError } = await db.rpc('consume_stock', {
    p_shop_id: tx.seller_shop_id,
    p_part_id: tx.part_id,
    p_qty: tx.quantity,
  });
  if (stockError) throw new Error(`Could not decrement stock: ${stockError.message}`);

  let transferId: string | null = null;
  let simulated = tx.simulated || input.source === 'simulator' || isSimulated();
  let note = '';

  if (tx.type === 'inter_shop_purchase') {
    const outcome = await placeSellerShareOnHold(tx, input.paymentId ?? tx.razorpay_payment_id);
    transferId = outcome.transferId;
    simulated = simulated || outcome.simulated;
    note = outcome.note;
  } else {
    note = 'Retail sale captured.';
  }

  const nextStatus: Transaction['status'] = tx.type === 'inter_shop_purchase' ? 'on_hold' : 'completed';

  const { data: updated, error: updateError } = await db
    .from('transactions')
    .update({
      status: nextStatus,
      paid_at: new Date().toISOString(),
      razorpay_payment_id: input.paymentId ?? tx.razorpay_payment_id,
      razorpay_order_id: input.orderId ?? tx.razorpay_order_id,
      razorpay_transfer_id: transferId ?? tx.razorpay_transfer_id,
      simulated,
    })
    .eq('id', tx.id)
    .select('*')
    .single();

  if (updateError) throw new Error(`Could not update transaction: ${updateError.message}`);

  return {
    transaction: updated as Transaction,
    alreadyProcessed: false,
    transferId,
    simulated,
    note,
  };
}

/**
 * Route split + Settlement Hold for a shop-to-shop purchase.
 *
 * Order of preference:
 *   1. The transfer Razorpay already created from the Payment Link's
 *      options.order.transfers — just read its id and make sure it is held.
 *   2. No transfer found -> create one directly on the captured payment.
 *   3. Anything above impossible (no keys, mock Linked Account, API refusal)
 *      -> record a clearly-marked simulated transfer id and say so in the UI.
 */
async function placeSellerShareOnHold(
  tx: Transaction,
  paymentId: string | null | undefined,
): Promise<{ transferId: string | null; simulated: boolean; note: string }> {
  const db = supabaseAdmin();

  const { data: sellerRow } = await db
    .from('shops')
    .select('*')
    .eq('id', tx.seller_shop_id)
    .maybeSingle();
  const seller = sellerRow as Shop | null;

  const sellerShare = tx.amount_paise - tx.platform_fee_paise;
  const holdUntil = tx.hold_until ? new Date(tx.hold_until) : null;

  if (isSimulated() || !paymentId || isMockLinkedAccount(seller?.razorpay_linked_account_id)) {
    return {
      transferId: `trf_SIM${tx.id.replace(/-/g, '').slice(0, 12)}`,
      simulated: true,
      note: isSimulated()
        ? 'No Razorpay keys configured — Route split and settlement hold are simulated.'
        : `Seller has no live Route Linked Account (${seller?.razorpay_linked_account_id ?? 'none'}), so the split of ` +
          `${sellerShare} paise and the settlement hold are simulated. Real onboarding needs KYC.`,
    };
  }

  const spec: RouteTransferSpec = {
    account: seller!.razorpay_linked_account_id!,
    amount: sellerShare,
    currency: 'INR',
    on_hold: true,
    ...(holdUntil ? { on_hold_until: Math.floor(holdUntil.getTime() / 1000) } : {}),
    notes: { partloop_transaction_id: tx.id, kind: 'inter_shop_purchase' },
  };

  try {
    const existing = await fetchPaymentTransfers(paymentId);
    if (existing.length > 0) {
      const transfer = existing[0];
      if (!transfer.on_hold) {
        await setTransferHold(transfer.id, true, holdUntil);
      }
      return {
        transferId: transfer.id,
        simulated: false,
        note: 'Route transfer created by the Payment Link split; settlement is on hold.',
      };
    }

    const created = await createPaymentTransfer(paymentId, [spec]);
    return {
      transferId: created[0]?.id ?? null,
      simulated: false,
      note: 'Route transfer created directly on the captured payment; settlement is on hold.',
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      transferId: `trf_SIM${tx.id.replace(/-/g, '').slice(0, 12)}`,
      simulated: true,
      note: `Razorpay refused the Route transfer (${reason}); recorded as a simulated split.`,
    };
  }
}

/**
 * Buyer confirms handoff -> release the seller's money.
 * Only the buying shop can do this, and only on a held transaction.
 */
export async function releaseHold(
  transactionId: string,
  actingShopId: string,
): Promise<{ transaction: Transaction; simulated: boolean; note: string }> {
  const db = supabaseAdmin();

  const { data: txRow, error } = await db
    .from('transactions')
    .select('*')
    .eq('id', transactionId)
    .maybeSingle();

  if (error) throw new Error(`Could not load transaction: ${error.message}`);
  if (!txRow) throw new Error('Transaction not found.');

  const tx = txRow as Transaction;

  if (tx.type !== 'inter_shop_purchase') {
    throw new Error('Only a shop-to-shop purchase has a settlement hold to release.');
  }
  if (tx.buyer_shop_id !== actingShopId) {
    throw new Error('Only the buying shop can confirm receipt.');
  }
  if (tx.status === 'released' || tx.status === 'completed') {
    return { transaction: tx, simulated: tx.simulated, note: 'Already released.' };
  }
  if (tx.status !== 'on_hold' && tx.status !== 'paid') {
    throw new Error(`Cannot release a transaction in status "${tx.status}".`);
  }

  let simulated = tx.simulated;
  let note = 'Settlement hold released — the seller will be settled on the next cycle.';

  const transferIsReal = tx.razorpay_transfer_id && !tx.razorpay_transfer_id.startsWith('trf_SIM');

  if (transferIsReal && !isSimulated()) {
    try {
      await setTransferHold(tx.razorpay_transfer_id!, false);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      simulated = true;
      note = `Razorpay refused the hold release (${reason}); marked released locally only.`;
    }
  } else {
    simulated = true;
    note = 'Simulated release — this transfer was never a live Route transfer.';
  }

  const { data: updated, error: updateError } = await db
    .from('transactions')
    .update({
      status: 'released',
      released_at: new Date().toISOString(),
      simulated,
    })
    .eq('id', tx.id)
    .select('*')
    .single();

  if (updateError) throw new Error(`Could not update transaction: ${updateError.message}`);

  return { transaction: updated as Transaction, simulated, note };
}

/**
 * Asks Razorpay whether the Payment Link was actually paid, and fulfils if so.
 * This is what makes the demo work without a public webhook URL — it is a real
 * Razorpay API read, not a local guess.
 */
export async function reconcileFromRazorpay(
  transactionId: string,
): Promise<{ changed: boolean; status: string; note: string; transaction: Transaction | null }> {
  const db = supabaseAdmin();

  const { data: txRow } = await db
    .from('transactions')
    .select('*')
    .eq('id', transactionId)
    .maybeSingle();

  const tx = txRow as Transaction | null;
  if (!tx) return { changed: false, status: 'missing', note: 'Transaction not found.', transaction: null };

  if (TERMINAL_PAID.has(tx.status)) {
    return { changed: false, status: tx.status, note: 'Already settled.', transaction: tx };
  }

  if (isSimulated() || !tx.razorpay_payment_link_id || tx.razorpay_payment_link_id.startsWith('plink_SIM')) {
    return {
      changed: false,
      status: tx.status,
      note: 'Simulated payment link — use the in-app simulator to complete it.',
      transaction: tx,
    };
  }

  const link = await fetchPaymentLink(tx.razorpay_payment_link_id);
  if (link.status !== 'paid') {
    return {
      changed: false,
      status: tx.status,
      note: `Razorpay reports the payment link as "${link.status}".`,
      transaction: tx,
    };
  }

  const paymentId = link.payments?.find((p) => p.status === 'captured')?.payment_id ?? null;
  const result = await fulfilPayment({
    transactionId: tx.id,
    paymentId,
    orderId: link.order_id ?? null,
    source: 'reconcile',
  });

  return {
    changed: !result.alreadyProcessed,
    status: result.transaction.status,
    note: result.note,
    transaction: result.transaction,
  };
}

/**
 * Captures payment for a counter bill.
 *
 * Note what this does NOT do: decrement stock. On a counter bill the money and
 * the handover are separate events — the customer has paid, but the parts are
 * still on the shelf until the shopkeeper says otherwise. deductBillStock() in
 * lib/data/bills.ts is the other half, driven by a button on the bill.
 *
 * Idempotent, like fulfilPayment(): the webhook and the reconcile poll can both
 * arrive and only the first one does anything.
 */
export async function fulfilBillPayment(input: {
  billId: string;
  paymentId?: string | null;
  orderId?: string | null;
  source: 'webhook' | 'reconcile' | 'simulator';
}): Promise<{ bill: Bill; alreadyProcessed: boolean; note: string }> {
  const db = supabaseAdmin();

  const { data: billRow, error } = await db
    .from('bills')
    .select('*')
    .eq('id', input.billId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the bill: ${error.message}`);
  if (!billRow) throw new Error(`Bill ${input.billId} not found.`);

  const bill = billRow as Bill;

  if (bill.status === 'paid' || bill.status === 'stocked') {
    return { bill, alreadyProcessed: true, note: `Bill already ${bill.status}.` };
  }
  if (bill.status === 'cancelled') {
    throw new Error('This bill was cancelled.');
  }

  const paidAt = new Date().toISOString();
  const paymentId = input.paymentId ?? bill.razorpay_payment_id;

  const { data: updated, error: updateError } = await db
    .from('bills')
    .update({
      status: 'paid',
      paid_at: paidAt,
      razorpay_payment_id: paymentId,
      razorpay_order_id: input.orderId ?? bill.razorpay_order_id,
      simulated: bill.simulated || input.source === 'simulator' || isSimulated(),
    })
    .eq('id', bill.id)
    .select('*')
    .single();

  if (updateError) throw new Error(`Could not update the bill: ${updateError.message}`);

  // Line items become revenue now — the money has arrived. They move to
  // 'completed' only once stock is deducted.
  const { error: linesError } = await db
    .from('transactions')
    .update({
      status: 'paid',
      paid_at: paidAt,
      razorpay_payment_id: paymentId,
      razorpay_order_id: input.orderId ?? bill.razorpay_order_id,
      simulated: bill.simulated || input.source === 'simulator' || isSimulated(),
    })
    .eq('bill_id', bill.id);

  if (linesError) throw new Error(`Could not update the bill items: ${linesError.message}`);

  return {
    bill: updated as Bill,
    alreadyProcessed: false,
    note: 'Payment captured. Stock is still on the shelf until you confirm handover.',
  };
}

/** Asks Razorpay whether a bill's payment link was actually paid, and captures if so. */
export async function reconcileBillFromRazorpay(
  billId: string,
): Promise<{ changed: boolean; status: string; note: string }> {
  const db = supabaseAdmin();

  const { data: billRow } = await db.from('bills').select('*').eq('id', billId).maybeSingle();
  const bill = billRow as Bill | null;
  if (!bill) return { changed: false, status: 'missing', note: 'Bill not found.' };

  if (bill.status === 'paid' || bill.status === 'stocked') {
    return { changed: false, status: bill.status, note: 'Already paid.' };
  }

  if (
    isSimulated() ||
    !bill.razorpay_payment_link_id ||
    bill.razorpay_payment_link_id.startsWith('plink_SIM')
  ) {
    return {
      changed: false,
      status: bill.status,
      note: 'Simulated payment link — use the in-app simulator to complete it.',
    };
  }

  const link = await fetchPaymentLink(bill.razorpay_payment_link_id);
  if (link.status !== 'paid') {
    return {
      changed: false,
      status: bill.status,
      note: `Razorpay reports the payment link as "${link.status}".`,
    };
  }

  const result = await fulfilBillPayment({
    billId: bill.id,
    paymentId: link.payments?.find((p) => p.status === 'captured')?.payment_id ?? null,
    orderId: link.order_id ?? null,
    source: 'reconcile',
  });

  return { changed: !result.alreadyProcessed, status: result.bill.status, note: result.note };
}

/** Flips reservations past their hold window to `expired`. Called on page load. */
export async function expireStaleReservations(): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc('expire_stale_reservations');
  if (error) return 0;
  return typeof data === 'number' ? data : 0;
}
