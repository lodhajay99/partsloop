const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const INR_PRECISE = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Paise -> "₹2,480". Money is stored and computed in paise everywhere. */
export function rupees(paise: number): string {
  return INR.format(paise / 100);
}

export function rupeesPrecise(paise: number): string {
  return INR_PRECISE.format(paise / 100);
}

export function rupeesToPaise(input: string | number): number {
  const value = typeof input === 'number' ? input : Number(input.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

/** "14 min ago" / "3 hours ago" / "2 days ago" — the freshness signal on search results. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** Search results fade as they age: fresh stock is the whole value proposition. */
export function freshnessTone(iso: string, now: Date = new Date()): 'fresh' | 'ok' | 'stale' {
  const hours = (now.getTime() - new Date(iso).getTime()) / 3_600_000;
  if (hours <= 6) return 'fresh';
  if (hours <= 48) return 'ok';
  return 'stale';
}

export function distanceLabel(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** [start, end) covering the calendar month containing `ref`, in local time. */
export function monthRange(ref: Date = new Date()): { start: Date; end: Date; label: string } {
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1, 0, 0, 0, 0);
  const label = ref.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  return { start, end, label };
}

export function minutesUntil(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - now.getTime()) / 60_000));
}
