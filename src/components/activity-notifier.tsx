'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';

import type { ActivityEvent } from '@/lib/data/activity';

/**
 * Pops a toast — and, when the shop is not looking at this tab, a real device
 * notification — for things that happen to a shop that this screen did not do.
 *
 * A shopkeeper is not sitting on the dashboard waiting. Another shop reserving
 * their stock, a customer scanning the QR, a buyer confirming handoff so the
 * held money is theirs: all arrive with no reason for anyone here to refresh,
 * and a counter that silently goes stale is how you sell a part you already
 * promised. At a counter the screen is usually behind you, so a chime is the
 * part that actually does the work.
 *
 * Polled, not pushed. Browser-side Realtime needs the anon key and an RLS
 * policy keyed on a JWT claim; this build authenticates with a plain shop
 * cookie, so there is no claim to key on.
 */

const POLL_MS = 20_000;
const PREF_KEY = 'partloop_alerts';
const PREF_EVENT = 'partloop:alerts-changed';

type AlertPref = 'on' | 'muted';

function readPref(): AlertPref {
  try {
    return localStorage.getItem(PREF_KEY) === 'muted' ? 'muted' : 'on';
  } catch {
    // Private windows and locked-down browsers throw on access, not on read.
    return 'on';
  }
}

function subscribeToPref(onChange: () => void): () => void {
  window.addEventListener(PREF_EVENT, onChange);
  // Muting on one tab should mute the shop's other tab too.
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(PREF_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function writePref(pref: AlertPref): void {
  try {
    localStorage.setItem(PREF_KEY, pref);
  } catch {
    /* the toggle still works for this tab; it just will not be remembered */
  }
  window.dispatchEvent(new CustomEvent(PREF_EVENT));
}

// ---------------------------------------------------------------------------
// The chime
// ---------------------------------------------------------------------------

let audioContext: AudioContext | null = null;

/**
 * Two short notes, synthesised rather than loaded.
 *
 * An audio file would be another request and another asset to ship for roughly
 * a fifth of a second of sound. Browsers also refuse to play anything until the
 * page has had a genuine user interaction, so the first chime after a cold load
 * may be silent — that is the autoplay policy, not a fault, and the toast and
 * device notification carry the message regardless.
 */
function playChime(): void {
  try {
    type WithLegacy = typeof window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (window as WithLegacy).webkitAudioContext;
    if (!Ctor) return;

    audioContext ??= new Ctor();
    const ctx = audioContext;
    if (ctx.state === 'suspended') void ctx.resume();

    const start = ctx.currentTime;
    for (const [index, frequency] of [880, 1174.7].entries()) {
      const at = start + index * 0.13;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = frequency;

      // Ramped, never switched: a square-edged gain change is an audible click.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.13, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);

      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.14);
    }
  } catch {
    /* no audio device, or a browser that will not allow it — never fatal */
  }
}

// ---------------------------------------------------------------------------
// The header control
// ---------------------------------------------------------------------------

export function AlertToggle() {
  // The preference lives only in the browser, so the server cannot render it.
  // useSyncExternalStore hands React a server snapshot ('on') and swaps to the
  // stored value after hydration, without a setState-in-effect flash.
  const pref = useSyncExternalStore(
    subscribeToPref,
    () => readPref(),
    () => 'on' as AlertPref,
  );

  const toggle = useCallback(() => {
    const next: AlertPref = readPref() === 'on' ? 'muted' : 'on';
    writePref(next);

    if (next === 'on') {
      // This click is the user gesture both the audio and the permission
      // prompt need, so ask for everything here rather than on page load.
      playChime();
      if ('Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
      toast.success('Alerts on', {
        description: 'You will hear a chime when something happens to this shop.',
      });
    } else {
      toast('Alerts muted', { description: 'Notices still appear on screen, silently.' });
    }
  }, []);

  const on = pref === 'on';

  return (
    <button
      type="button"
      onClick={toggle}
      title={on ? 'Alerts on — click to mute' : 'Alerts muted — click to turn on'}
      aria-label={on ? 'Mute alerts' : 'Turn on alerts'}
      aria-pressed={on}
      className="grid size-9 shrink-0 place-items-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {on ? <Bell className="size-4" aria-hidden /> : <BellOff className="size-4" aria-hidden />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The poller
// ---------------------------------------------------------------------------

export function ActivityNotifier() {
  const router = useRouter();

  const since = useRef<string>(new Date().toISOString());
  const seen = useRef<Set<string>>(new Set());
  const inFlight = useRef(false);

  const announce = useCallback(
    (event: ActivityEvent) => {
      const muted = readPref() === 'muted';
      if (!muted) playChime();

      // When the tab is not on screen an in-page toast reaches nobody, so hand
      // it to the operating system instead — that is the whole point of asking
      // for the permission. Falls back to the toast when it was never granted.
      const canUseDevice =
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        document.visibilityState !== 'visible';

      if (canUseDevice) {
        try {
          const note = new Notification(event.title, {
            body: event.body,
            tag: event.id, // the same event twice replaces, never stacks
            silent: muted,
          });
          note.onclick = () => {
            window.focus();
            router.push(event.href);
            note.close();
          };
          return;
        } catch {
          /* fall through to the toast */
        }
      }

      toast(event.title, {
        description: event.body,
        duration: 9000,
        action: { label: 'Open', onClick: () => router.push(event.href) },
      });
    },
    [router],
  );

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;

    try {
      const res = await fetch(`/api/activity?since=${encodeURIComponent(since.current)}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;

      const body = (await res.json()) as { events?: ActivityEvent[]; now?: string };

      let announced = false;
      for (const event of body.events ?? []) {
        if (seen.current.has(event.id)) continue;
        seen.current.add(event.id);
        announce(event);
        announced = true;
      }

      // Only ever advance on the server's clock. A laptop running a few seconds
      // fast would step over events that had not been written yet.
      if (body.now) since.current = body.now;

      if (announced && document.visibilityState === 'visible') router.refresh();
    } catch {
      /* a dropped poll is not worth reporting; the next one is 20s away */
    } finally {
      inFlight.current = false;
    }
  }, [announce, router]);

  useEffect(() => {
    // Kept running while hidden on purpose: a backgrounded tab is exactly when
    // a device notification earns its keep. Browsers throttle a hidden tab's
    // timers to roughly once a minute, which is the cost of it and is fine.
    const timer = setInterval(() => void poll(), POLL_MS);

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
