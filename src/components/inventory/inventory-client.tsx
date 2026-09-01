'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { relativeTime, rupeesToPaise } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { InventoryLine } from '@/lib/data/inventory';
import type { PartMatch } from '@/types/db';

export function InventoryClient({
  lines,
  lowStockThreshold,
}: {
  lines: InventoryLine[];
  lowStockThreshold: number;
}) {
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (l) =>
        l.part_name.toLowerCase().includes(q) ||
        l.aliases.some((a) => a.toLowerCase().includes(q)) ||
        l.category.toLowerCase().includes(q),
    );
  }, [lines, filter]);

  return (
    <div className="space-y-5">
      <AddPartPanel existingPartIds={new Set(lines.map((l) => l.part_id))} />

      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter my stock"
          className="pl-9"
          aria-label="Filter my stock"
        />
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {lines.length === 0 ? 'You have no stock listed yet.' : 'Nothing matches that filter.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((line) => (
            <li key={line.id}>
              <InventoryRow line={line} lowStockThreshold={lowStockThreshold} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InventoryRow({
  line,
  lowStockThreshold,
}: {
  line: InventoryLine;
  lowStockThreshold: number;
}) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [price, setPrice] = useState((line.price_paise / 100).toFixed(0));
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = Number(quantity) !== line.quantity || rupeesToPaise(price) !== line.price_paise;

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          part_id: line.part_id,
          quantity: Number(quantity),
          price_paise: rupeesToPaise(price),
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save.');

      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1600);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }, [line.part_id, quantity, price, router]);

  const remove = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/inventory?part_id=${line.part_id}`, { method: 'DELETE' });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not remove.');
      toast.success(`Removed ${line.part_name}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove.');
      setSaving(false);
    }
  }, [line.part_id, line.part_name, router]);

  const low = line.quantity < lowStockThreshold;

  return (
    <div
      className={cn(
        'flex flex-wrap items-end gap-x-4 gap-y-3 rounded-lg border p-3.5',
        low ? 'border-warning/30 bg-warning-soft/40' : 'bg-card',
      )}
    >
      <div className="min-w-0 flex-1 basis-64">
        <p className="truncate font-medium">{line.part_name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {line.category} · verified {relativeTime(line.last_verified_at)}
          {low ? <span className="ml-2 font-medium text-warning">running low</span> : null}
        </p>
      </div>

      <div className="w-20">
        <Label htmlFor={`qty-${line.id}`} className="text-xs text-muted-foreground">
          Qty
        </Label>
        <Input
          id={`qty-${line.id}`}
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ''))}
          className="mt-1 tabular-nums"
        />
      </div>

      <div className="w-28">
        <Label htmlFor={`price-${line.id}`} className="text-xs text-muted-foreground">
          Price ₹
        </Label>
        <Input
          id={`price-${line.id}`}
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))}
          className="mt-1 tabular-nums"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={() => void save()} disabled={saving || (!dirty && !justSaved)} size="sm">
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : justSaved ? (
            <Check className="size-4" aria-hidden />
          ) : null}
          {justSaved ? 'Saved' : dirty ? 'Save' : 'Saved'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void remove()}
          disabled={saving}
          aria-label={`Remove ${line.part_name}`}
        >
          <Trash2 className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function AddPartPanel({ existingPartIds }: { existingPartIds: Set<string> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<PartMatch[]>([]);
  const [selected, setSelected] = useState<PartMatch | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!open || selected) return;
    const trimmed = query.trim();
    if (!trimmed) return;

    const handle = setTimeout(async () => {
      const mine = ++seq.current;
      try {
        const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(trimmed)}`);
        const body = (await res.json()) as { parts?: PartMatch[] };
        if (mine === seq.current) setMatches(body.parts ?? []);
      } catch {
        // A failed lookup just means no suggestions; the toast noise is not worth it.
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [query, open, selected]);

  // Derived rather than cleared in the effect: an empty box shows no
  // suggestions without a second render pass.
  const suggestions = query.trim() ? matches : [];

  const add = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          part_id: selected.id,
          quantity: Number(quantity || '0'),
          price_paise: rupeesToPaise(price),
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not add the part.');

      toast.success(`${selected.canonical_name} added to your stock`);
      setSelected(null);
      setQuery('');
      setPrice('');
      setQuantity('1');
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the part.');
    } finally {
      setSaving(false);
    }
  }, [selected, quantity, price, router]);

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Add a part
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Add a part to your stock</h2>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>

      {selected ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <span className="font-medium">{selected.canonical_name}</span>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              change
            </Button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-24">
              <Label htmlFor="new-qty" className="text-xs text-muted-foreground">
                Quantity
              </Label>
              <Input
                id="new-qty"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ''))}
                className="mt-1 tabular-nums"
              />
            </div>
            <div className="w-32">
              <Label htmlFor="new-price" className="text-xs text-muted-foreground">
                Your price ₹
              </Label>
              <Input
                id="new-price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="2400"
                className="mt-1 tabular-nums"
              />
            </div>
            <Button onClick={() => void add()} disabled={saving || !price}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Add to stock
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the catalog — try 'swift brek ped'"
            autoFocus
          />
          {suggestions.length > 0 ? (
            <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
              {suggestions.map((part) => {
                const already = existingPartIds.has(part.id);
                return (
                  <li key={part.id}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => setSelected(part)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{part.canonical_name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {part.aliases.slice(0, 3).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {already ? 'already listed' : part.category}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
