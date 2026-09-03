import { NextResponse } from 'next/server';

import { apiError, readJson } from '@/lib/api';
import { requireSessionShopApi } from '@/lib/auth/session';
import { createPart } from '@/lib/data/inventory';

export const dynamic = 'force-dynamic';

interface Body {
  name?: string;
  category?: string;
  searched_for?: string;
}

/**
 * Adds a part to the shared catalog so a shop can stock something the seed
 * never included.
 *
 * Deliberately not restricted to an admin: a parts network whose catalog only
 * grows when someone else adds a SKU is a catalog that is always missing what
 * you are holding. Duplicate protection lives in createPart().
 */
export async function POST(req: Request) {
  try {
    await requireSessionShopApi();
    const body = await readJson<Body>(req);

    if (!body.name?.trim()) throw new Error('The part needs a name.');

    const result = await createPart({
      name: body.name,
      category: body.category,
      searchedFor: body.searched_for,
    });

    return NextResponse.json({
      part: result.part,
      created: result.created,
      note: result.created
        ? 'Added to the shared catalog.'
        : 'That part was already in the catalog — using the existing one.',
    });
  } catch (err) {
    return apiError(err);
  }
}
