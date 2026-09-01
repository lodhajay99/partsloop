import 'server-only';

import { monthRange } from '@/lib/format';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { PaymentMethod, TransactionStatus, TransactionType } from '@/types/db';

/**
 * The monthly dashboard.
 *
 * Reads from `transactions` and nothing else. There is no second bookkeeping
 * table, no manual ledger, no CSV import — because every sale (walk-in customer
 * or another shop) was charged through Razorpay, the month's books are just a
 * query over the payment records. That is the whole argument of the product.
 */

/** Money that actually moved. Reservations and expiries are not revenue. */
export const SETTLED_STATUSES: TransactionStatus[] = ['paid', 'on_hold', 'released', 'completed'];

export const LOW_STOCK_THRESHOLD = Number(process.env.NEXT_PUBLIC_LOW_STOCK_THRESHOLD ?? '3');

export interface LedgerEntry {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  created_at: string;
  quantity: number;
  amount_paise: number;
  platform_fee_paise: number;
  simulated: boolean;
  is_seed: boolean;
  razorpay_payment_id: string | null;
  razorpay_transfer_id: string | null;
  /** Set when this row was a line on a counter bill. */
  bill_id: string | null;
  payment_method: PaymentMethod;
  part_name: string;
  seller_shop_id: string;
  seller_name: string;
  buyer_shop_id: string | null;
  buyer_name: string | null;
  /** Which side of this transaction the viewing shop is on. */
  direction: 'retail_sale' | 'sold_to_shop' | 'bought_from_shop';
}

export interface DashboardData {
  monthLabel: string;
  retail: { count: number; grossPaise: number };
  soldToShops: { count: number; grossPaise: number; feePaise: number };
  boughtFromShops: { count: number; grossPaise: number };
  totalEarnedPaise: number;
  totalTransactions: number;
  daily: Array<{ day: number; date: string; retailPaise: number; wholesalePaise: number }>;
  entries: LedgerEntry[];
  pendingReservations: number;
  awaitingRelease: number;
  lowStock: Array<{ part_id: string; part_name: string; quantity: number; price_paise: number }>;
}

interface RawRow {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  created_at: string;
  quantity: number;
  amount_paise: number;
  platform_fee_paise: number;
  simulated: boolean;
  is_seed: boolean;
  razorpay_payment_id: string | null;
  razorpay_transfer_id: string | null;
  bill_id: string | null;
  payment_method: PaymentMethod;
  seller_shop_id: string;
  buyer_shop_id: string | null;
  part: { canonical_name: string } | null;
  seller: { name: string } | null;
  buyer: { name: string } | null;
}

/**
 * The most recent month this shop has any activity in.
 *
 * A month-to-date dashboard is legitimately near-empty on the 1st, which is
 * correct but useless to look at — and on the 1st what a shop actually wants is
 * last month's closed books. So the dashboard defaults to the latest month with
 * something in it rather than to "now", and says which month it is showing.
 *
 * Returns null for a shop that has never traded; the caller falls back to today.
 */
export async function getLatestMonthWithActivity(shopId: string): Promise<Date | null> {
  const { data } = await supabaseAdmin()
    .from('transactions')
    .select('created_at')
    .or(`seller_shop_id.eq.${shopId},buyer_shop_id.eq.${shopId}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const latest = new Date((data as { created_at: string }).created_at);
  return new Date(latest.getFullYear(), latest.getMonth(), 1);
}

/** Parses a `?month=YYYY-MM` param, ignoring anything malformed or in the future. */
export function parseMonthParam(value: string | undefined, now: Date = new Date()): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11) return null;

  const candidate = new Date(year, month, 1);
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (candidate > thisMonth) return null;

  return candidate;
}

export function monthParam(ref: Date): string {
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`;
}

export async function getDashboardData(shopId: string, ref: Date = new Date()): Promise<DashboardData> {
  const db = supabaseAdmin();
  const { start, end, label } = monthRange(ref);

  const { data, error } = await db
    .from('transactions')
    .select(
      `id, type, status, created_at, quantity, amount_paise, platform_fee_paise,
       simulated, is_seed, razorpay_payment_id, razorpay_transfer_id, bill_id, payment_method,
       seller_shop_id, buyer_shop_id,
       part:parts!transactions_part_id_fkey(canonical_name),
       seller:shops!transactions_seller_shop_id_fkey(name),
       buyer:shops!transactions_buyer_shop_id_fkey(name)`,
    )
    .or(`seller_shop_id.eq.${shopId},buyer_shop_id.eq.${shopId}`)
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Could not load the ledger: ${error.message}`);

  const rows = (data ?? []) as unknown as RawRow[];

  const entries: LedgerEntry[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    created_at: r.created_at,
    quantity: r.quantity,
    amount_paise: r.amount_paise,
    platform_fee_paise: r.platform_fee_paise,
    simulated: r.simulated,
    is_seed: r.is_seed,
    razorpay_payment_id: r.razorpay_payment_id,
    razorpay_transfer_id: r.razorpay_transfer_id,
    bill_id: r.bill_id,
    payment_method: r.payment_method,
    part_name: r.part?.canonical_name ?? 'Unknown part',
    seller_shop_id: r.seller_shop_id,
    seller_name: r.seller?.name ?? 'Unknown shop',
    buyer_shop_id: r.buyer_shop_id,
    buyer_name: r.buyer?.name ?? null,
    direction:
      r.type === 'retail_sale'
        ? 'retail_sale'
        : r.seller_shop_id === shopId
          ? 'sold_to_shop'
          : 'bought_from_shop',
  }));

  const settled = entries.filter((e) => SETTLED_STATUSES.includes(e.status));

  const retail = settled.filter((e) => e.direction === 'retail_sale');
  const sold = settled.filter((e) => e.direction === 'sold_to_shop');
  const bought = settled.filter((e) => e.direction === 'bought_from_shop');

  const sum = (list: LedgerEntry[], pick: (e: LedgerEntry) => number) =>
    list.reduce((acc, e) => acc + pick(e), 0);

  // Day-by-day chart covers the whole month so the shape of the month is visible.
  const daysInMonth = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
  const daily = Array.from({ length: daysInMonth }, (_, i) => ({
    day: i + 1,
    date: new Date(ref.getFullYear(), ref.getMonth(), i + 1).toISOString(),
    retailPaise: 0,
    wholesalePaise: 0,
  }));

  for (const e of settled) {
    if (e.direction === 'bought_from_shop') continue;
    const day = new Date(e.created_at).getDate();
    const bucket = daily[day - 1];
    if (!bucket) continue;
    if (e.direction === 'retail_sale') bucket.retailPaise += e.amount_paise;
    else bucket.wholesalePaise += e.amount_paise - e.platform_fee_paise;
  }

  const { data: lowStockRows } = await db
    .from('inventory')
    .select('part_id, quantity, price_paise, part:parts!inventory_part_id_fkey(canonical_name)')
    .eq('shop_id', shopId)
    .lt('quantity', LOW_STOCK_THRESHOLD)
    .order('quantity', { ascending: true });

  const lowStock = ((lowStockRows ?? []) as unknown as Array<{
    part_id: string;
    quantity: number;
    price_paise: number;
    part: { canonical_name: string } | null;
  }>).map((r) => ({
    part_id: r.part_id,
    part_name: r.part?.canonical_name ?? 'Unknown part',
    quantity: r.quantity,
    price_paise: r.price_paise,
  }));

  const retailGross = sum(retail, (e) => e.amount_paise);
  const soldGross = sum(sold, (e) => e.amount_paise);
  const soldFees = sum(sold, (e) => e.platform_fee_paise);

  return {
    monthLabel: label,
    retail: { count: retail.length, grossPaise: retailGross },
    soldToShops: { count: sold.length, grossPaise: soldGross, feePaise: soldFees },
    boughtFromShops: { count: bought.length, grossPaise: sum(bought, (e) => e.amount_paise) },
    // What the shop actually keeps: retail in full, wholesale net of platform fee.
    totalEarnedPaise: retailGross + soldGross - soldFees,
    totalTransactions: settled.length,
    daily,
    entries,
    pendingReservations: entries.filter(
      (e) => e.direction === 'bought_from_shop' && e.status === 'reserved',
    ).length,
    awaitingRelease: entries.filter(
      (e) => e.direction === 'bought_from_shop' && (e.status === 'on_hold' || e.status === 'paid'),
    ).length,
    lowStock,
  };
}
