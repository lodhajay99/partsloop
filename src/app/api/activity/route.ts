import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { listActivity } from '@/lib/data/activity';

export const dynamic = 'force-dynamic';

/** Everything that happened to the signed-in shop since `since`. */
export async function GET(req: Request) {
  try {
    const shop = await requireSessionShopApi();

    const raw = new URL(req.url).searchParams.get('since');
    const parsed = raw ? new Date(raw) : null;

    // A missing or junk cursor must not replay the whole ledger as toasts, so
    // fall back to a short window rather than the beginning of time.
    const since =
      parsed && !Number.isNaN(parsed.getTime())
        ? new Date(Math.max(parsed.getTime(), Date.now() - 60 * 60_000))
        : new Date(Date.now() - 60_000);

    const result = await listActivity({ shopId: shop.id, since: since.toISOString() });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return apiError(err);
  }
}
