import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client using the service_role key.
 *
 * Why service_role: this build authenticates shops with a server-side picker
 * cookie rather than Supabase Auth, so there is no end-user JWT for RLS to key
 * off. Shop scoping is therefore enforced in the server layer (every query is
 * filtered by the session shop id from src/lib/auth/session.ts) and RLS stays
 * enabled as deny-by-default defence in depth. See supabase/migrations/0003_rls.sql.
 *
 * This module must never be imported from a client component. The service key
 * is read from a non-NEXT_PUBLIC env var, so bundling it would fail the build.
 */

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY in .env.local (see .env.example).',
    );
  }

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'partloop' } },
  });

  return cached;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
