import 'server-only';

import crypto from 'node:crypto';

import { supabaseAdmin } from '@/lib/supabase/admin';
import type { AvailabilityRow, SearchResult, Shop, TransactionStatus } from '@/types/db';

/**
 * Cross-shop availability search, with identity masking.
 *
 * A shop searching for a part it does not stock gets distance, quantity, price
 * and freshness — but not who has it — until it commits to a reservation.
 * Shops are competitors; leaking "Balaji has 4 of these" to anyone who types a
 * part name would make nobody willing to list stock.
 *
 * The masking happens here, on the server. Names and exact coordinates for
 * unreserved rows never leave the process — the browser cannot un-hide them.
 */

/** A reservation in one of these states reveals the seller to the buyer. */
const REVEALING_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  'reserved',
  'paid',
  'on_hold',
  'released',
  'completed',
]);

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  origin: { lat: number; lng: number; name: string };
  radiusKm: number;
}

export async function searchAvailability(input: {
  query: string;
  shop: Shop;
  radiusKm?: number;
  limit?: number;
}): Promise<SearchResponse> {
  const radiusKm = input.radiusKm ?? 25;
  const query = input.query.trim();

  const origin = { lat: input.shop.lat, lng: input.shop.lng, name: input.shop.name };

  if (!query) {
    return { query, results: [], origin, radiusKm };
  }

  const db = supabaseAdmin();

  const { data, error } = await db.rpc('search_available_parts', {
    p_query: query,
    p_shop_id: input.shop.id,
    p_radius_km: radiusKm,
    p_limit: input.limit ?? 25,
  });

  if (error) throw new Error(`Search failed: ${error.message}`);

  const rows = (data ?? []) as AvailabilityRow[];
  if (rows.length === 0) return { query, results: [], origin, radiusKm };

  // Which of these (seller, part) pairs has this shop already reserved?
  const { data: reservationRows } = await db
    .from('transactions')
    .select('id, seller_shop_id, part_id, status, created_at')
    .eq('buyer_shop_id', input.shop.id)
    .eq('type', 'inter_shop_purchase')
    .in('seller_shop_id', [...new Set(rows.map((r) => r.shop_id))])
    .in('part_id', [...new Set(rows.map((r) => r.part_id))])
    .order('created_at', { ascending: false });

  const reservations = new Map<string, { id: string; status: TransactionStatus }>();
  for (const r of (reservationRows ?? []) as Array<{
    id: string;
    seller_shop_id: string;
    part_id: string;
    status: TransactionStatus;
  }>) {
    const key = `${r.seller_shop_id}:${r.part_id}`;
    // Rows arrive newest-first, so the first one wins.
    if (!reservations.has(key)) reservations.set(key, { id: r.id, status: r.status });
  }

  // Pseudonyms are assigned nearest-first so "Shop A" is always the closest.
  const shopOrder = [...new Set([...rows].sort((a, b) => a.distance_km - b.distance_km).map((r) => r.shop_id))];
  const aliasByShop = new Map(shopOrder.map((id, i) => [id, `Shop ${letterFor(i)}`]));

  const results: SearchResult[] = rows.map((row) => {
    const reservation = reservations.get(`${row.shop_id}:${row.part_id}`);
    const revealed = Boolean(reservation && REVEALING_STATUSES.has(reservation.status));
    const jittered = approximateLocation(row.shop_id, row.shop_lat, row.shop_lng);

    return {
      inventory_id: row.inventory_id,
      part_id: row.part_id,
      part_name: row.part_name,
      category: row.category,
      quantity: row.quantity,
      price_paise: row.price_paise,
      last_verified_at: row.last_verified_at,
      distance_km: row.distance_km,
      match_score: row.match_score,
      alias_label: aliasByShop.get(row.shop_id) ?? 'Shop',
      revealed,
      shop_id: revealed ? row.shop_id : null,
      shop_name: revealed ? row.shop_name : null,
      shop_address: revealed ? row.shop_address : null,
      lat: revealed ? row.shop_lat : jittered.lat,
      lng: revealed ? row.shop_lng : jittered.lng,
      // Only a live reservation is surfaced. A declined or expired one must not
      // leave the row stuck showing "Open reservation" — the whole point of
      // declining is that the part goes back into open search.
      reservation_id: revealed ? (reservation?.id ?? null) : null,
      reservation_status: revealed ? (reservation?.status ?? null) : null,
    };
  });

  return { query, results, origin, radiusKm };
}

/**
 * Deterministic ~200-450 m offset for an unrevealed shop, so the map can show
 * roughly where the part is without pinning the doorway. Derived from the shop
 * id, so the marker does not jitter between renders.
 */
function approximateLocation(shopId: string, lat: number, lng: number): { lat: number; lng: number } {
  const hash = crypto.createHash('sha256').update(shopId).digest();
  const bearing = (hash[0] / 255) * Math.PI * 2;
  const metres = 200 + (hash[1] / 255) * 250;

  const dLat = (metres * Math.cos(bearing)) / 111_320;
  const dLng = (metres * Math.sin(bearing)) / (111_320 * Math.cos((lat * Math.PI) / 180));

  return { lat: lat + dLat, lng: lng + dLng };
}

function letterFor(index: number): string {
  if (index < ALPHABET.length) return ALPHABET[index];
  return `${ALPHABET[Math.floor(index / ALPHABET.length) - 1]}${ALPHABET[index % ALPHABET.length]}`;
}
