'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Clock, EyeOff, Loader2, MapPin, Package, Search } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { distanceLabel, freshnessTone, relativeTime, rupees } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SearchResult } from '@/types/db';

const ResultsMap = dynamic(() => import('./results-map').then((m) => m.ResultsMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-muted" />,
});

interface SearchResponse {
  query: string;
  results: SearchResult[];
  origin: { lat: number; lng: number; name: string };
  radiusKm: number;
}

const SUGGESTIONS = ['i20 brake pad', 'creta hawa filter', 'wagonar shoker', 'amron battery'];

export function SearchClient({
  origin,
  initialQuery,
}: {
  origin: { lat: number; lng: number; name: string };
  initialQuery: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [reserving, setReserving] = useState<string | null>(null);

  // Guards against a slow earlier request overwriting a faster later one.
  const requestSeq = useRef(0);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setSearched(false);
      return;
    }

    const seq = ++requestSeq.current;
    setLoading(true);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { cache: 'no-store' });
      const body = (await res.json()) as SearchResponse & { error?: string };
      if (seq !== requestSeq.current) return;

      if (!res.ok) throw new Error(body.error ?? 'Search failed.');
      setResults(body.results);
      setSearched(true);
    } catch (err) {
      if (seq === requestSeq.current) {
        toast.error(err instanceof Error ? err.message : 'Search failed.');
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  // Debounced as-you-type search.
  useEffect(() => {
    const handle = setTimeout(() => void runSearch(query), 280);
    return () => clearTimeout(handle);
  }, [query, runSearch]);

  const reserve = useCallback(
    async (row: SearchResult) => {
      setReserving(row.inventory_id);
      try {
        const res = await fetch('/api/reservations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inventory_id: row.inventory_id, quantity: 1 }),
        });
        const body = (await res.json()) as { transaction?: { id: string }; error?: string };
        if (!res.ok || !body.transaction) throw new Error(body.error ?? 'Could not reserve.');

        toast.success('Reserved for 30 minutes — the seller is now revealed.');
        router.push(`/transactions/${body.transaction.id}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not reserve.');
        setReserving(null);
      }
    },
    [router],
  );

  const grouped = useMemo(() => {
    const byPart = new Map<string, SearchResult[]>();
    for (const r of results) {
      const list = byPart.get(r.part_name) ?? [];
      list.push(r);
      byPart.set(r.part_name, list);
    }
    return [...byPart.entries()];
  }, [results]);

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What do you need? e.g. i20 brake pad, creta hawa filter"
            className="h-12 pr-10 pl-9 text-base"
            autoFocus
            aria-label="Search for a part"
          />
          {loading ? (
            <Loader2
              className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
              aria-hidden
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Try a messy one:</span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setQuery(s)}
              className="rounded-full border px-2.5 py-1 transition-colors hover:bg-accent"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {searched && results.length === 0 && !loading ? (
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing in stock nearby for &ldquo;{query}&rdquo;. Try a shorter phrase — the search matches
          on misspellings and aliases, but it can only find parts some shop has actually listed.
        </p>
      ) : null}

      {results.length > 0 ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-5 lg:order-1">
            {grouped.map(([partName, rows]) => (
              <section key={partName} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Package className="size-4 text-muted-foreground" aria-hidden />
                  <h2 className="text-sm font-semibold">{partName}</h2>
                  <span className="text-xs text-muted-foreground">
                    {rows.length} {rows.length === 1 ? 'shop has it' : 'shops have it'}
                  </span>
                </div>

                <ul className="space-y-2">
                  {rows.map((row) => (
                    <li key={row.inventory_id}>
                      <ResultCard
                        row={row}
                        reserving={reserving === row.inventory_id}
                        disabled={reserving !== null}
                        onReserve={() => void reserve(row)}
                        onOpen={() =>
                          row.reservation_id ? router.push(`/transactions/${row.reservation_id}`) : undefined
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="lg:order-2">
            <div className="sticky top-24 h-[22rem] overflow-hidden rounded-lg border lg:h-[30rem]">
              <ResultsMap origin={origin} results={results} />
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <EyeOff className="mt-px size-3 shrink-0" aria-hidden />
              Dashed circles are approximate. Shop names and exact locations appear only after you
              reserve.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ResultCard({
  row,
  reserving,
  disabled,
  onReserve,
  onOpen,
}: {
  row: SearchResult;
  reserving: boolean;
  disabled: boolean;
  onReserve: () => void;
  onOpen: () => void;
}) {
  const tone = freshnessTone(row.last_verified_at);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border p-3.5 transition-colors sm:flex-nowrap',
        row.revealed ? 'border-brand/35 bg-brand-soft/40' : 'bg-card hover:bg-accent/30',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {row.alias_label.replace('Shop ', '')}
          </span>
          <span className="truncate font-medium">
            {row.revealed ? row.shop_name : row.alias_label}
          </span>
          {!row.revealed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              <EyeOff className="size-3" aria-hidden />
              hidden
            </span>
          ) : null}
        </div>

        {row.revealed && row.shop_address ? (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
            <MapPin className="mt-px size-3 shrink-0" aria-hidden />
            {row.shop_address}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <MapPin className="size-3" aria-hidden />
            {distanceLabel(row.distance_km)} away
          </span>
          <span
            className={cn(
              'flex items-center gap-1',
              tone === 'fresh' && 'text-success',
              tone === 'ok' && 'text-muted-foreground',
              tone === 'stale' && 'text-warning',
            )}
          >
            <Clock className="size-3" aria-hidden />
            verified {relativeTime(row.last_verified_at)}
          </span>
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{row.quantity}</span> in stock
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <p className="text-lg font-semibold tabular-nums">{rupees(row.price_paise)}</p>

        {row.reservation_id ? (
          <Button variant="outline" onClick={onOpen}>
            Open reservation
          </Button>
        ) : (
          <Button onClick={onReserve} disabled={disabled}>
            {reserving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Reserve
          </Button>
        )}
      </div>
    </div>
  );
}
