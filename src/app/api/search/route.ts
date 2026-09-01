import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { expireStaleReservations } from '@/lib/data/fulfilment';
import { searchAvailability } from '@/lib/data/search';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const shop = await requireSessionShopApi();
    const url = new URL(req.url);

    // No cron in this build: stale reservations are swept whenever someone searches.
    await expireStaleReservations();

    const response = await searchAvailability({
      query: url.searchParams.get('q') ?? '',
      shop,
      radiusKm: Number(url.searchParams.get('radius') ?? '25'),
    });

    return NextResponse.json(response);
  } catch (err) {
    return apiError(err);
  }
}
