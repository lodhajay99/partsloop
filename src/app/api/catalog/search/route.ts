import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { searchCatalog } from '@/lib/data/inventory';

export const dynamic = 'force-dynamic';

/** Fuzzy part-catalog lookup for the inventory editor's picker. */
export async function GET(req: Request) {
  try {
    await requireSessionShopApi();
    const q = new URL(req.url).searchParams.get('q') ?? '';
    const parts = await searchCatalog(q);
    return NextResponse.json({ parts });
  } catch (err) {
    return apiError(err);
  }
}
