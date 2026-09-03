import 'server-only';

import { supabaseAdmin } from '@/lib/supabase/admin';
import type { PartMatch } from '@/types/db';

export interface InventoryLine {
  id: string;
  part_id: string;
  part_name: string;
  aliases: string[];
  category: string;
  quantity: number;
  price_paise: number;
  last_verified_at: string;
}

interface RawInventoryRow {
  id: string;
  part_id: string;
  quantity: number;
  price_paise: number;
  last_verified_at: string;
  part: { canonical_name: string; aliases: string[]; category: string } | null;
}

export async function getShopInventory(shopId: string): Promise<InventoryLine[]> {
  const { data, error } = await supabaseAdmin()
    .from('inventory')
    .select(
      `id, part_id, quantity, price_paise, last_verified_at,
       part:parts!inventory_part_id_fkey(canonical_name, aliases, category)`,
    )
    .eq('shop_id', shopId)
    .order('quantity', { ascending: true });

  if (error) throw new Error(`Could not load inventory: ${error.message}`);

  return ((data ?? []) as unknown as RawInventoryRow[])
    .map((r) => ({
      id: r.id,
      part_id: r.part_id,
      part_name: r.part?.canonical_name ?? 'Unknown part',
      aliases: r.part?.aliases ?? [],
      category: r.part?.category ?? 'other',
      quantity: r.quantity,
      price_paise: r.price_paise,
      last_verified_at: r.last_verified_at,
    }))
    .sort((a, b) => a.part_name.localeCompare(b.part_name));
}

/**
 * Adds or updates one stock line. Any write here counts as the shop confirming
 * it still holds that part, so last_verified_at is refreshed — that timestamp
 * is what the "verified 14 min ago" badge on search results reports.
 */
export async function upsertInventoryLine(input: {
  shopId: string;
  partId: string;
  quantity: number;
  pricePaise: number;
}): Promise<InventoryLine> {
  const { data, error } = await supabaseAdmin()
    .from('inventory')
    .upsert(
      {
        shop_id: input.shopId,
        part_id: input.partId,
        quantity: Math.max(0, Math.trunc(input.quantity)),
        price_paise: Math.max(0, Math.trunc(input.pricePaise)),
        last_verified_at: new Date().toISOString(),
      },
      { onConflict: 'shop_id,part_id' },
    )
    .select(
      `id, part_id, quantity, price_paise, last_verified_at,
       part:parts!inventory_part_id_fkey(canonical_name, aliases, category)`,
    )
    .single();

  if (error) throw new Error(`Could not save the stock line: ${error.message}`);

  const row = data as unknown as RawInventoryRow;
  return {
    id: row.id,
    part_id: row.part_id,
    part_name: row.part?.canonical_name ?? 'Unknown part',
    aliases: row.part?.aliases ?? [],
    category: row.part?.category ?? 'other',
    quantity: row.quantity,
    price_paise: row.price_paise,
    last_verified_at: row.last_verified_at,
  };
}

export async function removeInventoryLine(shopId: string, partId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('inventory')
    .delete()
    .eq('shop_id', shopId)
    .eq('part_id', partId);

  if (error) throw new Error(`Could not remove the stock line: ${error.message}`);
}

/** Catalog-wide fuzzy part search, for the "add a part" picker. */
export async function searchCatalog(query: string, limit = 12): Promise<PartMatch[]> {
  if (!query.trim()) return [];

  const { data, error } = await supabaseAdmin().rpc('search_parts', {
    p_query: query.trim(),
    p_limit: limit,
  });

  if (error) throw new Error(`Catalog search failed: ${error.message}`);
  return (data ?? []) as PartMatch[];
}

/** The categories already in use, for the "new part" picker. */
export async function listPartCategories(): Promise<string[]> {
  const { data } = await supabaseAdmin().from('parts').select('category');
  const seen = new Set<string>();
  for (const row of (data ?? []) as Array<{ category: string }>) {
    if (row.category) seen.add(row.category);
  }
  return [...seen].sort();
}

/**
 * Adds a part to the shared catalog.
 *
 * The catalog is shared by every shop, so a careless insert pollutes search for
 * all of them — "Bosch H4 bulb" and "bosch h4 bulb" as two rows means a buyer
 * finds half the stock that exists. So an existing part with the same name
 * (case- and space-insensitive) is returned instead of creating a second one,
 * and the phrase the shopkeeper actually typed is kept as an alias so the next
 * person searching those words finds it.
 */
export async function createPart(input: {
  name: string;
  category?: string;
  /** What the user typed to find it, kept as a search alias. */
  searchedFor?: string;
}): Promise<{ part: PartMatch; created: boolean }> {
  const db = supabaseAdmin();

  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 3) throw new Error('Give the part a name of at least 3 characters.');
  if (name.length > 120) throw new Error('That name is too long for a part.');

  const category = (input.category ?? 'other').trim().toLowerCase() || 'other';

  const alias = input.searchedFor?.trim().replace(/\s+/g, ' ').toLowerCase();
  const aliases = alias && alias !== name.toLowerCase() ? [alias] : [];

  // Case-insensitive duplicate check before inserting.
  const { data: existingRows } = await db
    .from('parts')
    .select('id, canonical_name, aliases, category')
    .ilike('canonical_name', name);

  const existing = (existingRows ?? []) as Array<{
    id: string;
    canonical_name: string;
    aliases: string[];
    category: string;
  }>;

  if (existing.length > 0) {
    const hit = existing[0];
    // Fold the new phrasing in, so the catalog gets better rather than duplicated.
    const merged = [...new Set([...(hit.aliases ?? []), ...aliases])];
    if (merged.length !== (hit.aliases ?? []).length) {
      await db.from('parts').update({ aliases: merged }).eq('id', hit.id);
    }
    return {
      part: { ...hit, aliases: merged, match_score: 1 },
      created: false,
    };
  }

  const { data, error } = await db
    .from('parts')
    .insert({ canonical_name: name, category, aliases })
    .select('id, canonical_name, aliases, category')
    .single();

  if (error) throw new Error(`Could not add the part to the catalog: ${error.message}`);

  const row = data as { id: string; canonical_name: string; aliases: string[]; category: string };
  return { part: { ...row, match_score: 1 }, created: true };
}

export async function getInventoryLine(shopId: string, partId: string): Promise<InventoryLine | null> {
  const { data } = await supabaseAdmin()
    .from('inventory')
    .select(
      `id, part_id, quantity, price_paise, last_verified_at,
       part:parts!inventory_part_id_fkey(canonical_name, aliases, category)`,
    )
    .eq('shop_id', shopId)
    .eq('part_id', partId)
    .maybeSingle();

  if (!data) return null;

  const row = data as unknown as RawInventoryRow;
  return {
    id: row.id,
    part_id: row.part_id,
    part_name: row.part?.canonical_name ?? 'Unknown part',
    aliases: row.part?.aliases ?? [],
    category: row.part?.category ?? 'other',
    quantity: row.quantity,
    price_paise: row.price_paise,
    last_verified_at: row.last_verified_at,
  };
}
