/**
 * Database types.
 *
 * Hand-written to mirror supabase/migrations. Once you have a linked Supabase
 * project, regenerate instead of editing by hand:
 *
 *   supabase gen types typescript --project-id <ref> --schema public > src/types/db.ts
 */

export type TransactionType = 'retail_sale' | 'inter_shop_purchase';

export type TransactionStatus =
  | 'created'
  | 'reserved'
  | 'paid'
  | 'on_hold'
  | 'released'
  | 'completed'
  | 'expired'
  /** The sale happened and was reversed. */
  | 'refunded'
  /** The sale never happened — the bill was voided before payment. */
  | 'cancelled';

export interface Shop {
  id: string;
  name: string;
  owner_phone: string;
  lat: number;
  lng: number;
  address: string | null;
  razorpay_linked_account_id: string | null;
  created_at: string;
}

export interface Part {
  id: string;
  canonical_name: string;
  aliases: string[];
  category: string;
  created_at: string;
}

export interface InventoryRow {
  id: string;
  shop_id: string;
  part_id: string;
  quantity: number;
  price_paise: number;
  last_verified_at: string;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  seller_shop_id: string;
  buyer_shop_id: string | null;
  part_id: string;
  quantity: number;
  amount_paise: number;
  platform_fee_paise: number;
  /** Razorpay's cut, added on top for the buyer. Never the seller's revenue. */
  processing_fee_paise: number;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  razorpay_payment_link_id: string | null;
  razorpay_payment_link_url: string | null;
  razorpay_transfer_id: string | null;
  /** Set when this row is a line item on a counter bill (see Bill). */
  bill_id: string | null;
  payment_method: PaymentMethod;
  simulated: boolean;
  is_seed: boolean;
  status: TransactionStatus;
  hold_until: string | null;
  paid_at: string | null;
  released_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  /** Which side called off an unpaid reservation. */
  cancelled_by_shop_id: string | null;
  created_at: string;
}

export type BillStatus = 'created' | 'paid' | 'stocked' | 'cancelled';

/**
 * How the customer paid. Razorpay is the default and the only method with a
 * payment record behind it; 'cash' is money straight into the till and is
 * badged as such everywhere it appears.
 */
export type PaymentMethod = 'razorpay' | 'cash';

/**
 * A counter bill: one Razorpay charge covering several parts sold together.
 * The line items are `transactions` rows carrying this bill's id.
 */
export interface Bill {
  id: string;
  shop_id: string;
  bill_number: number;
  /** Goods subtotal. The customer is charged this plus processing_fee_paise. */
  total_paise: number;
  /** Razorpay's cut, passed to the customer. Always 0 on a cash bill. */
  processing_fee_paise: number;
  status: BillStatus;
  razorpay_order_id: string | null;
  razorpay_payment_link_id: string | null;
  razorpay_payment_link_url: string | null;
  razorpay_payment_id: string | null;
  simulated: boolean;
  /** True for backdated demo history that never touched Razorpay. */
  is_seed: boolean;
  payment_method: PaymentMethod;
  paid_at: string | null;
  /** Null until the shopkeeper confirms the parts left the counter. */
  stock_deducted_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  /** Set when a paid Razorpay bill was reversed through the Refunds API. */
  razorpay_refund_id: string | null;
  created_at: string;
}

export interface BillLine {
  id: string;
  part_id: string;
  part_name: string;
  category: string;
  quantity: number;
  unit_price_paise: number;
  amount_paise: number;
  status: TransactionStatus;
}

export interface DetailedBill extends Bill {
  lines: BillLine[];
}

/** Row shape returned by the search_available_parts() SQL function. */
export interface AvailabilityRow {
  inventory_id: string;
  shop_id: string;
  shop_name: string;
  shop_address: string | null;
  shop_lat: number;
  shop_lng: number;
  linked_account_id: string | null;
  part_id: string;
  part_name: string;
  part_aliases: string[];
  category: string;
  quantity: number;
  price_paise: number;
  last_verified_at: string;
  distance_km: number;
  match_score: number;
}

/** Row shape returned by the search_parts() SQL function. */
export interface PartMatch {
  id: string;
  canonical_name: string;
  aliases: string[];
  category: string;
  match_score: number;
}

/**
 * A search result as it leaves the server for the browser.
 *
 * Identity fields (`shop_name`, `shop_address`, exact `shop_lat`/`shop_lng`)
 * are only populated once the searching shop holds a live reservation on that
 * inventory row. Before that they are null and the coordinates are jittered —
 * the masking happens server-side in src/app/api/search/route.ts, never in the
 * browser, so hidden identity is actually hidden.
 */
export interface SearchResult {
  inventory_id: string;
  part_id: string;
  part_name: string;
  category: string;
  quantity: number;
  price_paise: number;
  last_verified_at: string;
  distance_km: number;
  match_score: number;
  /** Stable per-search pseudonym, e.g. "Shop B". */
  alias_label: string;
  revealed: boolean;
  shop_id: string | null;
  shop_name: string | null;
  shop_address: string | null;
  lat: number;
  lng: number;
  /** Id of this shop's live reservation on this row, if any. */
  reservation_id: string | null;
  reservation_status: TransactionStatus | null;
}

/**
 * What the browser needs to open Razorpay Checkout. The key id is public by
 * design; the secret stays on the server and the payment is confirmed there.
 */
export interface CheckoutHandle {
  key_id: string;
  order_id: string;
  amount_paise: number;
}
