'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import type { ActivityEvent } from '@/lib/data/activity';

/**
 * Pops a toast when something happens to this shop that this screen did not do.
 *
 * A shopkeeper is not sitting on the dashboard waiting. Another shop reserving
 * their stock, a customer scanning the QR, a buyer confirming handoff — all
 * arrive with no reason for anyone here to have refreshed, and a counter that
 * silently goes stale is how you end up selling a part you already promised.
 *
 * Deliberately dumb about state: it asks the server what has happened since a
 * timestamp it holds, and the server derives the answer from the rows. The
 * first poll starts from "now", so signing in never dumps a week of history.
 */

const POLL_MS = 20_000;

export function ActivityNotifier() {
  const router = useRouter();

  const since = useRef<string>(new Date().toISOString());
  const seen = useRef<Set<string>>(new Set());
  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    // Nothing to announce to a tab nobody is looking at, and a backgrounded
    // demo laptop should not keep hitting the database.
    if (inFlight.current || document.visibilityState !== 'visible') return;
    inFlight.current = true;

    try {
      const res = await fetch(`/api/activity?since=${encodeURIComponent(since.current)}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;

      const body = (await res.json()) as { events?: ActivityEvent[]; now?: string };
      const events = body.events ?? [];

      let announced = false;
      for (const event of events) {
        if (seen.current.has(event.id)) continue;
        seen.current.add(event.id);
        announced = true;

        toast(event.title, {
          description: event.body,
          duration: 9000,
          action: { label: 'Open', onClick: () => router.push(event.href) },
        });
      }

      // Only advance the cursor on the server's clock, never the browser's —
      // a laptop running a few seconds fast would skip events entirely.
      if (body.now) since.current = body.now;

      // Something changed underneath whatever is on screen. Repaint it so the
      // toast and the page cannot disagree.
      if (announced) router.refresh();
    } catch {
      // A dropped poll is not worth telling anyone about; the next one is 20s away.
    } finally {
      inFlight.current = false;
    }
  }, [router]);

  useEffect(() => {
    const timer = setInterval(() => void poll(), POLL_MS);

    // Coming back to the tab is exactly when the news is worth having.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll]);

  return null;
}
