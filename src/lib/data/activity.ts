import 'server-only';

import { supabaseAdmin } from '@/lib/supabase/admin';
import { rupees } from '@/lib/format';

/**
 * Things that happened to a shop while nobody was looking at that screen.
 *
 * A shopkeeper has one till and one monitor. The events that matter to them are
 * the ones set off by somebody else — another shop reserving their stock, a
 * customer finally scanning the QR, a buyer confirming handoff so the money is
 * theirs. Those arrive with no reason for the shopkeeper to have refreshed.
 *
 * There is no push channel here on purpose. Browser-side Supabase Realtime
 * would need the anon key and an RLS policy keyed on a JWT claim, and this
 * build authenticates with a plain shop cookie — no JWT, so no claim to key on.
 * A poll against the session cookie is the honest mechanism for this demo, and
 * at a handful of shops it costs one small query every twenty seconds.
 *
 * Every event is derived from a timestamp already written by the flow that
 * caused it, so nothing has to be recorded twice and an event cannot exist for
 * something that did not actually happen.
 */

export type ActivityKind =
  | 'reservation_received'
  | 'payment_received'
  | 'payment_sent'
  | 'hold_released'
  | 'reservation_cancelled'
  | 'bill_paid';

export interface ActivityEvent {
  /** Stable across polls, so the same event is never toasted twice. */
  id: string;
  kind: ActivityKind;
  at: string;
  title: string;
  body: string;
  href: string;
}

interface TxRow {
  id: string;
  status: string;
  quantity: number;
  amount_paise: number;
  processing_fee_paise: number;
  seller_shop_id: string;
  buyer_shop_id: string | null;
  cancelled_by_shop_id: string | null;
  cancel_reason: string | null;
  created_at: string;
  paid_at: string | null;
  released_at: string | null;
  cancelled_at: string | null;
  part: { canonical_name: string } | null;
  seller: { name: string } | null;
  buyer: { name: string } | null;
}

const SELECT = `id, status, quantity, amount_paise, processing_fee_paise,
  seller_shop_id, buyer_shop_id, cancelled_by_shop_id, cancel_reason,
  created_at, paid_at, released_at, cancelled_at,
  part:parts!transactions_part_id_fkey(canonical_name),
  seller:shops!transactions_seller_shop_id_fkey(name),
  buyer:shops!transactions_buyer_shop_id_fkey(name)`;

export async function listActivity(input: {
  shopId: string;
  since: string;
}): Promise<{ events: ActivityEvent[]; now: string }> {
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const { shopId, since } = input;

  const [{ data: txData }, { data: billData }] = await Promise.all([
    db
      .from('transactions')
      .select(SELECT)
      .eq('type', 'inter_shop_purchase')
      .or(`seller_shop_id.eq.${shopId},buyer_shop_id.eq.${shopId}`)
      .or(
        `created_at.gt.${since},paid_at.gt.${since},released_at.gt.${since},cancelled_at.gt.${since}`,
      )
      .order('created_at', { ascending: false })
      .limit(40),
    db
      .from('bills')
      .select('id, bill_number, total_paise, processing_fee_paise, paid_at, payment_method')
      .eq('shop_id', shopId)
      .eq('is_seed', false)
      .gt('paid_at', since)
      .order('paid_at', { ascending: false })
      .limit(20),
  ]);

  const events: ActivityEvent[] = [];
  const after = (stamp: string | null): boolean => Boolean(stamp && stamp > since);

  for (const raw of (txData ?? []) as unknown as TxRow[]) {
    const tx = raw;
    const isSeller = tx.seller_shop_id === shopId;
    const part = tx.part?.canonical_name ?? 'a part';
    const them = (isSeller ? tx.buyer?.name : tx.seller?.name) ?? 'another shop';
    const href = `/transactions/${tx.id}`;
    const goods = rupees(tx.amount_paise);

    // A reservation only surprises the shop being reserved from. The buyer
    // pressed the button themselves a second ago.
    if (isSeller && after(tx.created_at)) {
      events.push({
        id: `${tx.id}:reserved`,
        kind: 'reservation_received',
        at: tx.created_at,
        title: 'New reservation on your stock',
        body: `${them} reserved ${tx.quantity} × ${part} — ${goods}. Hold it for them.`,
        href,
      });
    }

    if (after(tx.paid_at)) {
      events.push(
        isSeller
          ? {
              id: `${tx.id}:paid`,
              kind: 'payment_received',
              at: tx.paid_at!,
              title: `${them} has paid`,
              body: `${goods} for ${part}. Razorpay is holding your share until they confirm they have it.`,
              href,
            }
          : {
              id: `${tx.id}:paid`,
              kind: 'payment_sent',
              at: tx.paid_at!,
              title: 'Payment captured',
              body: `${goods} for ${part} from ${them}. Mark it received once you have collected.`,
              href,
            },
      );
    }

    if (after(tx.released_at) && isSeller) {
      events.push({
        id: `${tx.id}:released`,
        kind: 'hold_released',
        at: tx.released_at!,
        title: 'Your money has been released',
        body: `${them} confirmed handoff of ${part}. ${goods} settles to you on the next cycle.`,
        href,
      });
    }

    // Only the side that did not press the button needs telling.
    if (after(tx.cancelled_at) && tx.cancelled_by_shop_id !== shopId) {
      const declined = tx.cancelled_by_shop_id === tx.seller_shop_id;
      events.push({
        id: `${tx.id}:cancelled`,
        kind: 'reservation_cancelled',
        at: tx.cancelled_at!,
        title: declined ? `${them} declined the reservation` : `${them} cancelled their reservation`,
        body: tx.cancel_reason
          ? `${part} — “${tx.cancel_reason}”. Nothing was charged.`
          : `${part}. Nothing was charged, and the stock is back in the open pool.`,
        href,
      });
    }
  }

  for (const bill of (billData ?? []) as Array<{
    id: string;
    bill_number: number;
    total_paise: number;
    processing_fee_paise: number;
    paid_at: string;
    payment_method: string;
  }>) {
    // A cash bill is paid the instant it is written, by the person writing it.
    if (bill.payment_method === 'cash') continue;
    events.push({
      id: `${bill.id}:paid`,
      kind: 'bill_paid',
      at: bill.paid_at,
      title: `Bill #${String(bill.bill_number).padStart(4, '0')} paid`,
      body: `${rupees(bill.total_paise + bill.processing_fee_paise)} captured at the counter. Cut the stock when the parts leave.`,
      href: `/bills/${bill.id}`,
    });
  }

  events.sort((a, b) => a.at.localeCompare(b.at));
  return { events, now };
}
