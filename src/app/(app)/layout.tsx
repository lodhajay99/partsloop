import Link from 'next/link';
import { MapPin, Repeat2 } from 'lucide-react';

import { ActivityNotifier } from '@/components/activity-notifier';
import { AppNav } from '@/components/app-nav';
import { ModeChip } from '@/components/integration-banner';
import { SetupRequired } from '@/components/setup-required';
import { requireSessionShop } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/admin';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  if (!isSupabaseConfigured()) return <SetupRequired />;

  const shop = await requireSessionShop();

  return (
    <div className="flex min-h-svh flex-col">
      <ActivityNotifier />
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-md bg-brand text-sm font-bold text-brand-foreground">
              PL
            </span>
            <span className="text-base font-semibold tracking-tight">PartLoop</span>
          </Link>

          <AppNav />

          <div className="ml-auto flex items-center gap-3">
            <ModeChip />
            <Link
              href="/login"
              className="group flex items-center gap-2 rounded-md border px-3 py-1.5 text-left transition-colors hover:bg-accent"
              title="Switch demo shop"
            >
              <div className="hidden sm:block">
                <p className="text-sm leading-tight font-medium">{shop.name}</p>
                <p className="flex items-center gap-1 text-xs leading-tight text-muted-foreground">
                  <MapPin className="size-3" aria-hidden />
                  Pune
                </p>
              </div>
              <Repeat2 className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>

      <footer className="border-t py-5">
        <p className="mx-auto max-w-6xl px-4 text-xs text-muted-foreground sm:px-6">
          PartLoop · Razorpay Buildathon 2026 demo · test mode only. Settlement holds are an
          escrow-<em>like</em> pattern built on Razorpay Route, not a licensed escrow product.
        </p>
      </footer>
    </div>
  );
}
