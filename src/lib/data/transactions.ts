import 'server-only';

import {
  appUrl,
  createOrder,
  createPaymentLink,
  isMockLinkedAccount,
  isSimulated,
  paymentFeePaise,
  platformFeePaise,
  type RouteTransferSpec,
} from '@/lib/razorpay/client';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Shop, Transaction } from '@/types/db';

/**
 * Shop-to-shop purchases: reserve, then pay.
 *
 * The other kind of money movement — a walk-in counter sale — lives in
 * lib/data/bills.ts, because one customer can buy several parts on one charge.
 * Both land as rows in `transactions`, which is the point of the product: one
 * ledger and one dashboard cover the customer at the counter and the shop down
 * the road alike.
 */

export const RESERVATION_HOLD_MINUTES = Number(process.env.RESERVATION_HOLD_MINUTES ?? '30');

/** An active reservation blocks a second one on the same (seller, part) pair. */
const ACTIVE_RESERVATION_STATUSES = ['reserved', 'paid', 'on_hold'];

export interface DetailedTransaction extends Transaction {
  part_name: string;
  seller_name: string;
  seller_address: string | null;
  seller_phone: string;
  seller_lat: number;
  seller_lng: number;
  seller_linked_account_id: string | null;
  buyer_name: string | null;
}

const DETAIL_SELECT = `*,
  part:parts!transactions_part_id_fkey(canonical_name),
  seller:shops!transactions_seller_shop_id_fkey(name, address, owner_phone, lat, lng, razorpay_linked_account_id),
  buyer:shops!transactions_buyer_shop_id_fkey(name)`;

interface RawDetail extends Transaction {
  part: { canonical_name: string } | null;
  seller: {
    name: string;
    address: string | null;
    owner_phone: string;
    lat: number;
    lng: number;
    razorpay_linked_account_id: string | null;
  } | null;
  buyer: { name: string } | null;
}

function flatten(row: RawDetail): DetailedTransaction {
  const { part, seller, buyer, ...rest } = row;
  return {
    ...(rest as Transaction),
    part_name: part?.canonical_name ?? 'Unknown part',
    seller_name: seller?.name ?? 'Unknown shop',
    seller_address: seller?.address ?? null,
    seller_phone: seller?.owner_phone ?? '',
    seller_lat: seller?.lat ?? 0,
    seller_lng: seller?.lng ?? 0,
    seller_linked_account_id: seller?.razorpay_linked_account_id ?? null,
    buyer_name: buyer?.name ?? null,
  };
}

export async function getTransaction(id: string): Promise<DetailedTransaction | null> {
  const { data } = await supabaseAdmin()
    .from('transactions')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .maybeSingle();

  return data ? flatten(data as unknown as RawDetail) : null;
}

/** A shop may only see a transaction it is a party to. */
export function canShopSee(tx: DetailedTransaction, shopId: string): boolean {
  return tx.seller_shop_id === shopId || tx.buyer_shop_id === shopId;
}

// ---------------------------------------------------------------------------
// Feature 1: reserve, then pay
// ---------------------------------------------------------------------------

export async function createReservation(input: {
  buyerShop: Shop;
  /**
   * Opaque id of the inventory row from the search results. The buyer's browser
   * never learns the seller's shop id before reserving (see lib/data/search.ts),
   * so the seller is resolved here rather than trusted from the request.
   */
  inventoryId: string;
  quantity: number;
}): Promise<DetailedTransaction> {
  const db = supabaseAdmin();

  const quantity = Math.max(1, Math.trunc(input.quantity));

  const { data: stockRow } = await db
    .from('inventory')
    .select('shop_id, part_id, quantity, price_paise')
    .eq('id', input.inventoryId)
    .maybeSingle();

  const stock = stockRow as {
    shop_id: string;
    part_id: string;
    quantity: number;
    price_paise: number;
  } | null;

  if (!stock) throw new Error('That stock line no longer exists.');
  if (stock.shop_id === input.buyerShop.id) {
    throw new Error('You cannot reserve stock from your own shop.');
  }
  if (stock.quantity < quantity) {
    throw new Error(`Only ${stock.quantity} left at that shop.`);
  }

  const sellerShopId = stock.shop_id;
  const partId = stock.part_id;

  // Reusing a live reservation keeps Reserve idempotent under double-clicks.
  const { data: existing } = await db
    .from('transactions')
    .select('id')
    .eq('buyer_shop_id', input.buyerShop.id)
    .eq('seller_shop_id', sellerShopId)
    .eq('part_id', partId)
    .eq('type', 'inter_shop_purchase')
    .in('status', ACTIVE_RESERVATION_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const found = await getTransaction((existing as { id: string }).id);
    if (found) return found;
  }

  const amountPaise = stock.price_paise * quantity;
  const holdUntil = new Date(Date.now() + RESERVATION_HOLD_MINUTES * 60_000);

  const { data, error } = await db
    .from('transactions')
    .insert({
      type: 'inter_shop_purchase',
      seller_shop_id: sellerShopId,
      buyer_shop_id: input.buyerShop.id,
      part_id: partId,
      quantity,
      amount_paise: amountPaise,
      platform_fee_paise: platformFeePaise(amountPaise),
      // Razorpay's cut, added on top for the buyer, so the selling shop banks
      // the price it listed rather than quietly losing ~2.6% of it.
      processing_fee_paise: paymentFeePaise(amountPaise),
      status: 'reserved',
      hold_until: holdUntil.toISOString(),
    })
    .select(DETAIL_SELECT)
    .single();

  if (error) throw new Error(`Could not reserve: ${error.message}`);
  return flatten(data as unknown as RawDetail);
}

/**
 * Calls off an unpaid reservation, from either side.
 *
 * The seller declining is the case this exists for — the part is spoken for, or
 * the listing was stale — but the buyer changing their mind is the same
 * operation, so both go through one path and the row records which side did it.
 *
 * Nothing to unwind: stock only moves on payment capture, so an unpaid
 * reservation was never holding any. Anything already paid is refused rather
 * than silently detached from its captured payment.
 */
export async function cancelReservation(input: {
  transactionId: string;
  actingShopId: string;
  reason?: string;
}): Promise<{
  transaction: DetailedTransaction;
  previousStatus: string;
  cancelledBySeller: boolean;
  alreadyCancelled: boolean;
  note: string;
}> {
  const { data, error } = await supabaseAdmin().rpc('cancel_reservation', {
    p_transaction_id: input.transactionId,
    p_acting_shop_id: input.actingShopId,
    p_reason: input.reason ?? null,
  });

  if (error) throw new Error(error.message);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { previous_status: string; cancelled_by_seller: boolean; already_cancelled: boolean }
    | undefined;

  const updated = await getTransaction(input.transactionId);
  if (!updated) throw new Error('The reservation vanished while being cancelled.');

  const bySeller = row?.cancelled_by_seller ?? false;

  return {
    transaction: updated,
    previousStatus: row?.previous_status ?? 'reserved',
    cancelledBySeller: bySeller,
    alreadyCancelled: row?.already_cancelled ?? false,
    note: row?.already_cancelled
      ? 'This reservation was already called off.'
      : bySeller
        ? 'Declined. The stock is back in open search for other shops.'
        : 'Reservation cancelled. Nothing was charged.',
  };
}

/**
 * Creates the Razorpay Order and Payment Link for a reservation.
 *
 * The Route split rides on the Payment Link as `options.order.transfers`:
 * seller share (amount minus platform fee) to the seller's Linked Account,
 * created `on_hold` so nothing settles until the buyer confirms handoff.
 */
export async function createPaymentForReservation(
  transactionId: string,
  actingShopId: string,
): Promise<{ transaction: DetailedTransaction; paymentUrl: string; routeIsSimulated: boolean; note: string }> {
  const db = supabaseAdmin();

  const tx = await getTransaction(transactionId);
  if (!tx) throw new Error('Reservation not found.');
  if (tx.buyer_shop_id !== actingShopId) throw new Error('Only the buying shop can pay for this.');
  if (tx.type !== 'inter_shop_purchase') throw new Error('This is not a shop-to-shop purchase.');
  if (tx.status === 'expired') throw new Error('This reservation expired. Search again to re-reserve.');
  if (tx.status !== 'reserved' && tx.status !== 'created') {
    throw new Error(`This reservation is already ${tx.status}.`);
  }

  // Re-hand the same link if one was already created.
  if (tx.razorpay_payment_link_url) {
    return {
      transaction: tx,
      paymentUrl: tx.razorpay_payment_link_url,
      routeIsSimulated: tx.simulated,
      note: 'Reusing the payment link already created for this reservation.',
    };
  }

  const sellerShare = tx.amount_paise - tx.platform_fee_paise;
  const routeIsSimulated = isSimulated() || isMockLinkedAccount(tx.seller_linked_account_id);

  const transfers: RouteTransferSpec[] | undefined = routeIsSimulated
    ? undefined
    : [
        {
          account: tx.seller_linked_account_id!,
          amount: sellerShare,
          currency: 'INR',
          on_hold: true,
          ...(tx.hold_until ? { on_hold_until: Math.floor(new Date(tx.hold_until).getTime() / 1000) } : {}),
          notes: { partloop_transaction_id: tx.id },
        },
      ];

  // The buyer pays for the goods and for moving the money; the seller's Route
  // transfer is unaffected by the surcharge.
  const chargedPaise = tx.amount_paise + tx.processing_fee_paise;

  const order = await createOrder({
    amountPaise: chargedPaise,
    receipt: `psl_${tx.id.slice(0, 30)}`,
    notes: { partloop_transaction_id: tx.id, type: 'inter_shop_purchase' },
    transfers,
  });

  const link = await createPaymentLink({
    amountPaise: chargedPaise,
    description: `${tx.quantity} x ${tx.part_name} from ${tx.seller_name}`,
    referenceId: tx.id,
    callbackUrl: `${appUrl()}/transactions/${tx.id}?from=razorpay`,
    notes: { partloop_transaction_id: tx.id, type: 'inter_shop_purchase' },
    transfers,
    simulatorUrl: `${appUrl()}/simulate/pay/${tx.id}`,
  });

  const { data, error } = await db
    .from('transactions')
    .update({
      razorpay_order_id: order.id,
      razorpay_payment_link_id: link.id,
      razorpay_payment_link_url: link.short_url,
      simulated: tx.simulated || routeIsSimulated,
    })
    .eq('id', tx.id)
    .select(DETAIL_SELECT)
    .single();

  if (error) throw new Error(`Could not save the payment link: ${error.message}`);

  return {
    transaction: flatten(data as unknown as RawDetail),
    paymentUrl: link.short_url,
    routeIsSimulated,
    note: routeIsSimulated
      ? isSimulated()
        ? 'No Razorpay keys are configured, so this payment link is simulated end to end.'
        : `The seller's Route Linked Account is a mock id (${tx.seller_linked_account_id ?? 'none'}), so the ` +
          'split and settlement hold are simulated. Real onboarding requires KYC.'
      : `Live Razorpay Payment Link with a Route split: ${sellerShare} paise to ${tx.seller_linked_account_id}, ` +
        `held until the buyer confirms handoff. Platform keeps ${tx.platform_fee_paise} paise.`,
  };
}
