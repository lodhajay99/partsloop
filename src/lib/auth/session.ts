import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Shop } from '@/types/db';

/**
 * Demo authentication.
 *
 * This build ships a shop picker, not phone+OTP: the hackathon budget went into
 * the Razorpay flows instead. Picking a shop writes an httpOnly cookie holding
 * that shop's uuid; every server route resolves the acting shop from it. There
 * is no password, so this is a demo affordance and nothing more — swapping in
 * Supabase Auth phone OTP means replacing getSessionShop() and populating a
 * `shop_id` claim, at which point the RLS policies in 0003_rls.sql go live.
 */

const COOKIE_NAME = 'partloop_shop';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export async function setSessionShop(shopId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, shopId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function clearSessionShop(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getSessionShopId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE_NAME)?.value ?? null;
}

/** Returns the signed-in shop, or null when the cookie is missing or stale. */
export async function getSessionShop(): Promise<Shop | null> {
  const shopId = await getSessionShopId();
  if (!shopId) return null;

  const { data, error } = await supabaseAdmin()
    .from('shops')
    .select('*')
    .eq('id', shopId)
    .maybeSingle();

  if (error || !data) return null;
  return data as Shop;
}

/** Page-level guard: bounces to /login when there is no session. */
export async function requireSessionShop(): Promise<Shop> {
  const shop = await getSessionShop();
  if (!shop) redirect('/login');
  return shop;
}

/** API-level guard: throws so route handlers can return a clean 401. */
export class UnauthenticatedError extends Error {
  constructor() {
    super('No shop selected. Pick a shop at /login.');
    this.name = 'UnauthenticatedError';
  }
}

export async function requireSessionShopApi(): Promise<Shop> {
  const shop = await getSessionShop();
  if (!shop) throw new UnauthenticatedError();
  return shop;
}
