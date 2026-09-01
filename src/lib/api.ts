import { NextResponse } from 'next/server';

import { UnauthenticatedError } from '@/lib/auth/session';

/** Uniform JSON error shape for every route handler. */
export function apiError(err: unknown): NextResponse {
  if (err instanceof UnauthenticatedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }

  const message = err instanceof Error ? err.message : 'Something went wrong.';
  console.error('[partloop:api]', message);
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error('Expected a JSON body.');
  }
}
