import { redirect } from 'next/navigation';
import { ArrowRight, MapPin } from 'lucide-react';

import { SetupRequired } from '@/components/setup-required';
import { Button } from '@/components/ui/button';
import { setSessionShop } from '@/lib/auth/session';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import type { Shop } from '@/types/db';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Choose your shop · PartLoop' };

/** The shop the demo script starts from — it is deliberately out of the hero part. */
const DEMO_SHOP_NAME = 'Shree Auto Spares';

/**
 * Demo sign-in.
 *
 * This is a shop picker, not phone+OTP. The hackathon time went into the
 * Razorpay flows instead, and this is stated plainly here and in the README
 * rather than dressed up as authentication. Picking a shop sets an httpOnly
 * cookie that every server route reads. See src/lib/auth/session.ts.
 */
export default async function LoginPage() {
  if (!isSupabaseConfigured()) return <SetupRequired />;

  const { data, error } = await supabaseAdmin()
    .from('shops')
    .select('*')
    .order('name', { ascending: true });

  const shops = (data ?? []) as Shop[];

  async function choose(formData: FormData) {
    'use server';
    const shopId = String(formData.get('shop_id') ?? '');
    if (!shopId) return;
    await setSessionShop(shopId);
    redirect('/dashboard');
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center gap-8 px-5 py-14">
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-md bg-brand text-sm font-bold text-brand-foreground">
            PL
          </span>
          <span className="text-lg font-semibold tracking-tight">PartLoop</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          One ledger for every sale — the walk-in customer and the shop down the road.
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Sign in as one of the six demo shops in Pune. There is no password: this build ships a
          shop picker instead of phone OTP, so the time went into the Razorpay payment flows.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load shops: {error.message}. Have you run the migrations and{' '}
          <code>supabase/seed.sql</code>?
        </p>
      ) : null}

      {shops.length === 0 && !error ? (
        <p className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          No shops found. Run <code>supabase/seed.sql</code> against your database, then reload.
        </p>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2">
        {shops.map((shop) => (
          <li key={shop.id}>
            <form action={choose}>
              <input type="hidden" name="shop_id" value={shop.id} />
              <Button
                type="submit"
                variant="outline"
                className="h-auto w-full justify-between gap-4 rounded-lg px-4 py-4 text-left whitespace-normal"
              >
                <span className="min-w-0 space-y-1">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{shop.name}</span>
                    {shop.name === DEMO_SHOP_NAME ? (
                      <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold tracking-wide text-brand uppercase">
                        demo shop
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="mt-px size-3 shrink-0" aria-hidden />
                    <span>{shop.address}</span>
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
