import 'server-only';

import {
  appUrl,
  createOrder,
  checkoutHandle,
  tryCreatePaymentLink,
  isSimulated,
  paymentFeePaise,
  refundPayment,
} from '@/lib/razorpay/client';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type {
  Bill,
  BillLine,
  BillStatus,
  CheckoutHandle,
  DetailedBill,
  PaymentMethod,
  Shop,
} from '@/types/db';

/**
 * Counter bills — a walk-in customer buying several parts in one go.
 *
 * One bill = one Razorpay charge = several `transactions` rows, one per line.
 * The bill row holds the payment envelope; the money stays in `transactions`,
 * so the monthly dashboard still reads one table and nothing else.
 *
 * Two ways to pay, and the difference decides when stock moves:
 *
 *   Razorpay — the customer scans and pays. Capture and handover are separate
 *   moments (the parts are still on the shelf while the QR is on screen), so
 *   capture only marks the bill `paid` and the shopkeeper cuts stock after.
 *
 *   Cash — the money is already in the till and the parts are already in the
 *   customer's hand. There is no gap to model, so the bill is written and stock
 *   is cut in one action.
 *
 * See deductBillStock(), which both paths funnel through.
 */

export interface BillDraftLine {
  part_id: string;
  quantity: number;
  unit_price_paise: number;
}

const LINE_SELECT = `id, part_id, quantity, amount_paise, status,
  part:parts!transactions_part_id_fkey(canonical_name, category)`;

interface RawLine {
  id: string;
  part_id: string;
  quantity: number;
  amount_paise: number;
  status: BillLine['status'];
  part: { canonical_name: string; category: string } | null;
}

function flattenLine(row: RawLine): BillLine {
  return {
    id: row.id,
    part_id: row.part_id,
    part_name: row.part?.canonical_name ?? 'Unknown part',
    category: row.part?.category ?? 'other',
    quantity: row.quantity,
    amount_paise: row.amount_paise,
    unit_price_paise: Math.round(row.amount_paise / Math.max(1, row.quantity)),
    status: row.status,
  };
}

export async function getBill(billId: string): Promise<DetailedBill | null> {
  const db = supabaseAdmin();

  const { data: billRow } = await db.from('bills').select('*').eq('id', billId).maybeSingle();
  if (!billRow) return null;

  const { data: lineRows } = await db
    .from('transactions')
    .select(LINE_SELECT)
    .eq('bill_id', billId)
    .order('created_at', { ascending: true });

  const lines = ((lineRows ?? []) as unknown as RawLine[]).map(flattenLine);

  return { ...(billRow as Bill), lines };
}

/**
 * Creates the bill, its line items, and the Razorpay charge for the total.
 *
 * Stock is checked here but NOT decremented — that happens when the shopkeeper
 * confirms handover. Validation runs against the shop's own inventory so a
 * client cannot bill for a part it does not stock or for someone else's stock.
 */
export async function createBill(input: {
  shop: Shop;
  lines: BillDraftLine[];
  /**
   * 'razorpay' opens a charge and waits for the customer to pay.
   * 'cash' records money already in the till — see the cash branch below.
   */
  paymentMethod?: PaymentMethod;
}): Promise<{
  bill: DetailedBill;
  paymentUrl: string | null;
  checkout: CheckoutHandle | null;
  stockCut: boolean;
  note: string;
}> {
  const db = supabaseAdmin();
  const paymentMethod: PaymentMethod = input.paymentMethod ?? 'razorpay';

  if (input.lines.length === 0) throw new Error('A bill needs at least one item.');
  if (input.lines.length > 40) throw new Error('That is more lines than one counter bill should have.');

  // Collapse duplicate taps of the same part into one line.
  const merged = new Map<string, BillDraftLine>();
  for (const line of input.lines) {
    const quantity = Math.trunc(line.quantity);
    const unit = Math.trunc(line.unit_price_paise);
    if (!line.part_id) throw new Error('Every line needs a part.');
    if (quantity < 1) throw new Error('Every line needs a quantity of at least 1.');
    if (unit <= 0) throw new Error('Every line needs a price above zero.');

    const existing = merged.get(line.part_id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      merged.set(line.part_id, { part_id: line.part_id, quantity, unit_price_paise: unit });
    }
  }

  const lines = [...merged.values()];

  const { data: stockRows, error: stockError } = await db
    .from('inventory')
    .select('part_id, quantity, part:parts!inventory_part_id_fkey(canonical_name)')
    .eq('shop_id', input.shop.id)
    .in(
      'part_id',
      lines.map((l) => l.part_id),
    );

  if (stockError) throw new Error(`Could not check your stock: ${stockError.message}`);

  const stock = new Map(
    ((stockRows ?? []) as unknown as Array<{
      part_id: string;
      quantity: number;
      part: { canonical_name: string } | null;
    }>).map((r) => [r.part_id, { quantity: r.quantity, name: r.part?.canonical_name ?? 'That part' }]),
  );

  for (const line of lines) {
    const held = stock.get(line.part_id);
    if (!held) throw new Error('One of those parts is not in your inventory.');
    if (held.quantity < line.quantity) {
      throw new Error(`You only have ${held.quantity} × ${held.name} in stock.`);
    }
  }

  const totalPaise = lines.reduce((sum, l) => sum + l.unit_price_paise * l.quantity, 0);
  const isCash = paymentMethod === 'cash';
  const paidAt = new Date().toISOString();

  // Cash has no processor to reimburse, so no surcharge. On a Razorpay bill the
  // customer covers what Razorpay will deduct, leaving the shop with the price
  // it actually listed.
  const processingFeePaise = isCash ? 0 : paymentFeePaise(totalPaise);
  const chargedPaise = totalPaise + processingFeePaise;

  const bill = await insertBillWithNumber(
    input.shop.id,
    totalPaise,
    paymentMethod,
    isCash ? paidAt : null,
    processingFeePaise,
  );

  const { error: linesError } = await db.from('transactions').insert(
    lines.map((line) => ({
      type: 'retail_sale' as const,
      seller_shop_id: input.shop.id,
      buyer_shop_id: null,
      part_id: line.part_id,
      quantity: line.quantity,
      amount_paise: line.unit_price_paise * line.quantity,
      platform_fee_paise: 0,
      // Cash is already in the till, so the line is revenue immediately.
      status: isCash ? ('paid' as const) : ('created' as const),
      paid_at: isCash ? paidAt : null,
      payment_method: paymentMethod,
      bill_id: bill.id,
    })),
  );

  if (linesError) {
    // A bill with no lines is worse than no bill at all.
    await db.from('bills').delete().eq('id', bill.id);
    throw new Error(`Could not save the bill items: ${linesError.message}`);
  }

  // ---- Cash: the money and the parts change hands in the same moment --------
  //
  // There is no waiting for a customer to scan, so unlike the Razorpay flow
  // there is nothing to sit between "paid" and "handed over" — the bill is
  // written and the stock comes off in one action. If the deduction somehow
  // fails, the bill still stands as paid and the "Cut stock" button is there to
  // finish the job, rather than losing the sale entirely.
  if (isCash) {
    let stockCut = false;
    let note = `₹${(totalPaise / 100).toFixed(0)} recorded as cash. `;

    try {
      const result = await deductBillStock(bill.id, input.shop.id);
      stockCut = !result.alreadyDone || result.linesDeducted > 0;
      note += `Stock cut for ${lines.length} ${lines.length === 1 ? 'part' : 'parts'}.`;
    } catch (err) {
      note += `Stock could not be cut automatically (${
        err instanceof Error ? err.message : 'unknown error'
      }) — use the button on the bill.`;
    }

    const saved = await getBill(bill.id);
    if (!saved) throw new Error('The bill vanished right after it was created.');

    return { bill: saved, paymentUrl: null, checkout: null, stockCut, note };
  }

  const description =
    lines.length === 1
      ? `${lines[0].quantity} item at ${input.shop.name}`
      : `${lines.length} items at ${input.shop.name}`;

  const order = await createOrder({
    amountPaise: chargedPaise,
    receipt: `psl_bill_${bill.id.slice(0, 24)}`,
    notes: { partloop_bill_id: bill.id, type: 'counter_bill' },
  });

  const link = await tryCreatePaymentLink({
    amountPaise: chargedPaise,
    description,
    referenceId: bill.id,
    callbackUrl: `${appUrl()}/bills/${bill.id}?from=razorpay`,
    notes: { partloop_bill_id: bill.id, type: 'counter_bill' },
    simulatorUrl: `${appUrl()}/bills/${bill.id}`,
  });

  const { error: updateError } = await db
    .from('bills')
    .update({
      razorpay_order_id: order.id,
      razorpay_payment_link_id: link?.id ?? null,
      razorpay_payment_link_url: link?.short_url ?? null,
      simulated: isSimulated(),
    })
    .eq('id', bill.id);

  if (updateError) throw new Error(`Could not save the payment details: ${updateError.message}`);

  // Mirror the Razorpay ids onto the line rows so the ledger table and the
  // transaction views keep working without knowing about bills.
  await db
    .from('transactions')
    .update({
      razorpay_order_id: order.id,
      razorpay_payment_link_id: link?.id ?? null,
      simulated: isSimulated(),
    })
    .eq('bill_id', bill.id);

  const saved = await getBill(bill.id);
  if (!saved) throw new Error('The bill vanished right after it was created.');

  return {
    bill: saved,
    paymentUrl: link?.short_url ?? null,
    checkout: checkoutHandle(order.id, chargedPaise),
    stockCut: false,
    note: isSimulated()
      ? 'Simulated payment — no Razorpay keys configured.'
      : 'Live Razorpay order. Show the QR to the customer.',
  };
}

/**
 * Per-shop bill numbers come from max+1, which can collide under concurrency.
 * The unique constraint turns that into an error rather than a duplicate, so
 * retry a few times instead of serialising every bill behind a lock.
 */
async function insertBillWithNumber(
  shopId: string,
  totalPaise: number,
  paymentMethod: PaymentMethod,
  paidAt: string | null,
  processingFeePaise: number,
): Promise<Bill> {
  const db = supabaseAdmin();

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: nextNumber, error: numberError } = await db.rpc('next_bill_number', {
      p_shop_id: shopId,
    });
    if (numberError) throw new Error(`Could not allocate a bill number: ${numberError.message}`);

    const { data, error } = await db
      .from('bills')
      .insert({
        shop_id: shopId,
        bill_number: (nextNumber as number) ?? 1,
        total_paise: totalPaise,
        processing_fee_paise: processingFeePaise,
        payment_method: paymentMethod,
        status: paidAt ? 'paid' : 'created',
        paid_at: paidAt,
      })
      .select('*')
      .single();

    if (!error) return data as Bill;
    // 23505 = unique_violation: someone else took this number, try the next one.
    if ((error as { code?: string }).code !== '23505') {
      throw new Error(`Could not open a bill: ${error.message}`);
    }
  }

  throw new Error('Could not allocate a bill number — too many bills opened at once.');
}

/**
 * "Cut the stock" — the shopkeeper confirms the parts left the counter.
 * Idempotent, and refuses to run before the bill is paid.
 */
export async function deductBillStock(
  billId: string,
  shopId: string,
): Promise<{ linesDeducted: number; alreadyDone: boolean }> {
  const { data, error } = await supabaseAdmin().rpc('deduct_bill_stock', {
    p_bill_id: billId,
    p_shop_id: shopId,
  });

  if (error) throw new Error(error.message);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { lines_deducted: number; already_done: boolean }
    | undefined;

  return {
    linesDeducted: row?.lines_deducted ?? 0,
    alreadyDone: row?.already_done ?? false,
  };
}

/**
 * Cancels a bill, reversing whatever actually happened.
 *
 * What "cancel" means depends entirely on how far the bill got:
 *
 *   created  — nobody paid. Void it. Nothing else to undo.
 *   paid     — money arrived, parts still on the shelf. Return the money.
 *   stocked  — money arrived and parts left. Return the money AND put the
 *              parts back.
 *
 * The money is returned before the ledger is touched, so a failed refund leaves
 * the bill standing rather than producing books that claim a reversal that never
 * reached the customer. For a cash bill there is nothing to call — the shopkeeper
 * hands the notes back — so it is recorded as a cash refund and flagged as having
 * no Razorpay record, exactly like the original cash sale.
 */
export async function cancelBill(input: {
  billId: string;
  shopId: string;
  reason?: string;
}): Promise<{
  bill: DetailedBill;
  alreadyCancelled: boolean;
  previousStatus: BillStatus;
  stockRestored: number;
  refundId: string | null;
  note: string;
}> {
  const db = supabaseAdmin();

  const existing = await getBill(input.billId);
  if (!existing) throw new Error('Bill not found.');
  if (existing.shop_id !== input.shopId) throw new Error('That bill belongs to another shop.');

  if (existing.status === 'cancelled') {
    return {
      bill: existing,
      alreadyCancelled: true,
      previousStatus: 'cancelled',
      stockRestored: 0,
      refundId: existing.razorpay_refund_id,
      note: 'This bill was already cancelled.',
    };
  }

  const wasPaid = existing.status === 'paid' || existing.status === 'stocked';
  const isCash = existing.payment_method === 'cash';

  // ---- Money first ---------------------------------------------------------
  let refundId: string | null = null;
  let refundNote = '';

  if (wasPaid && !isCash) {
    if (!existing.razorpay_payment_id) {
      throw new Error(
        'This bill is marked paid but carries no Razorpay payment id, so the refund cannot be ' +
          'issued automatically. Refund it from the Razorpay dashboard, then cancel again.',
      );
    }

    // A failed refund must abort the cancel: better a bill that is still open
    // than books saying money went back when it did not.
    const refund = await refundPayment({
      paymentId: existing.razorpay_payment_id,
      // Refund what they actually paid, surcharge included.
      amountPaise: existing.total_paise + existing.processing_fee_paise,
      notes: { partloop_bill_id: existing.id, reason: input.reason ?? 'cancelled at counter' },
    });

    refundId = refund.id;
    refundNote = refund._simulated
      ? ' Refund is simulated — no Razorpay keys configured.'
      : ` Refunded through Razorpay (${refund.id}).`;
  } else if (wasPaid && isCash) {
    refundNote = ' Hand the cash back to the customer — there is no Razorpay record to reverse.';
  }

  // ---- Then the ledger and the shelf ---------------------------------------
  const { data, error } = await db.rpc('cancel_bill', {
    p_bill_id: input.billId,
    p_shop_id: input.shopId,
    p_reason: input.reason ?? null,
  });

  if (error) throw new Error(`Could not cancel the bill: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { restored_lines: number; previous_status: BillStatus; already_cancelled: boolean }
    | undefined;

  if (refundId) {
    await db.from('bills').update({ razorpay_refund_id: refundId }).eq('id', input.billId);
  }

  const updated = await getBill(input.billId);
  if (!updated) throw new Error('The bill vanished while being cancelled.');

  const restored = row?.restored_lines ?? 0;
  const stockNote =
    restored > 0
      ? ` ${restored} ${restored === 1 ? 'part is' : 'parts are'} back in stock.`
      : '';

  return {
    bill: updated,
    alreadyCancelled: row?.already_cancelled ?? false,
    previousStatus: row?.previous_status ?? existing.status,
    stockRestored: restored,
    refundId,
    note:
      (wasPaid ? 'Bill reversed.' : 'Bill voided — it was never paid.') + refundNote + stockNote,
  };
}

// ---------------------------------------------------------------------------
// Dashboard board: money taken over the counter
// ---------------------------------------------------------------------------

export interface CounterBillSummary {
  id: string;
  bill_number: number;
  total_paise: number;
  status: BillStatus;
  item_count: number;
  unit_count: number;
  created_at: string;
  paid_at: string | null;
  stock_deducted_at: string | null;
  simulated: boolean;
  is_seed: boolean;
  payment_method: PaymentMethod;
}

export interface CounterTakings {
  /** True when the month being viewed is the one we are living in. */
  isCurrentMonth: boolean;
  /**
   * Live month: takings so far today.
   * Closed month: the busiest single day, because "today" is not a day in it.
   */
  todayPaise: number;
  todayCount: number;
  /** Set only for a closed month — which day the figure above refers to. */
  bestDayLabel: string | null;
  monthPaise: number;
  monthCount: number;
  averageBillPaise: number;
  /** Split of the month's takings by how the customer paid. */
  razorpayPaise: number;
  razorpayCount: number;
  cashPaise: number;
  cashCount: number;
  awaitingPayment: number;
  awaitingStock: number;
  recent: CounterBillSummary[];
}

/** Cancelled bills are deliberately absent: a reversed sale is not takings. */
const PAID_BILL_STATUSES: BillStatus[] = ['paid', 'stocked'];

export async function getCounterTakings(
  shopId: string,
  ref: Date = new Date(),
  now: Date = new Date(),
): Promise<CounterTakings> {
  const db = supabaseAdmin();

  const monthStart = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const monthEnd = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
  const isCurrentMonth =
    ref.getFullYear() === now.getFullYear() && ref.getMonth() === now.getMonth();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const { data, error } = await db
    .from('bills')
    .select('*, lines:transactions!transactions_bill_id_fkey(quantity)')
    .eq('shop_id', shopId)
    .gte('created_at', monthStart.toISOString())
    .lt('created_at', monthEnd.toISOString())
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Could not load counter takings: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<Bill & { lines: Array<{ quantity: number }> | null }>;

  const bills: CounterBillSummary[] = rows.map((b) => ({
    id: b.id,
    bill_number: b.bill_number,
    total_paise: b.total_paise,
    status: b.status,
    item_count: b.lines?.length ?? 0,
    unit_count: (b.lines ?? []).reduce((sum, l) => sum + l.quantity, 0),
    created_at: b.created_at,
    paid_at: b.paid_at,
    stock_deducted_at: b.stock_deducted_at,
    simulated: b.simulated,
    is_seed: b.is_seed,
    payment_method: b.payment_method,
  }));

  const paid = bills.filter((b) => PAID_BILL_STATUSES.includes(b.status));

  // In the live month "today" is today. In a closed month there is no today, so
  // report the busiest day instead of silently summing the whole month into a
  // tile labelled "taken today".
  let headlinePaise = 0;
  let headlineCount = 0;
  let bestDayLabel: string | null = null;

  if (isCurrentMonth) {
    const today = paid.filter((b) => new Date(b.paid_at ?? b.created_at) >= dayStart);
    headlinePaise = today.reduce((sum, b) => sum + b.total_paise, 0);
    headlineCount = today.length;
  } else {
    const byDay = new Map<number, { paise: number; count: number }>();
    for (const b of paid) {
      const day = new Date(b.paid_at ?? b.created_at).getDate();
      const acc = byDay.get(day) ?? { paise: 0, count: 0 };
      acc.paise += b.total_paise;
      acc.count += 1;
      byDay.set(day, acc);
    }

    let bestDay = 0;
    for (const [day, acc] of byDay) {
      if (acc.paise > headlinePaise) {
        headlinePaise = acc.paise;
        headlineCount = acc.count;
        bestDay = day;
      }
    }

    bestDayLabel = bestDay
      ? new Date(ref.getFullYear(), ref.getMonth(), bestDay).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
        })
      : null;
  }

  const monthPaise = paid.reduce((sum, b) => sum + b.total_paise, 0);
  const byCash = paid.filter((b) => b.payment_method === 'cash');
  const byRazorpay = paid.filter((b) => b.payment_method === 'razorpay');

  return {
    isCurrentMonth,
    todayPaise: headlinePaise,
    todayCount: headlineCount,
    bestDayLabel,
    monthPaise,
    monthCount: paid.length,
    averageBillPaise: paid.length > 0 ? Math.round(monthPaise / paid.length) : 0,
    razorpayPaise: byRazorpay.reduce((sum, b) => sum + b.total_paise, 0),
    razorpayCount: byRazorpay.length,
    cashPaise: byCash.reduce((sum, b) => sum + b.total_paise, 0),
    cashCount: byCash.length,
    awaitingPayment: bills.filter((b) => b.status === 'created').length,
    awaitingStock: bills.filter((b) => b.status === 'paid').length,
    recent: bills.slice(0, 6),
  };
}
