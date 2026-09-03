'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote, Loader2, Minus, Plus, QrCode, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { rupees, rupeesPrecise, rupeesToPaise } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { InventoryLine } from '@/lib/data/inventory';
import type { PaymentMethod } from '@/types/db';

/**
 * The counter bill.
 *
 * Tap a part to put it on the bill; tap again to add another of the same. A
 * walk-in customer buying a filter, a bulb and a wiper set is one bill and one
 * Razorpay charge, not three separate sales.
 *
 * Prices default to the shop's listed price but stay editable per line — haggling
 * at the counter is normal, and a bill that cannot reflect it gets abandoned for
 * a paper one.
 */

interface CartLine {
  part_id: string;
  part_name: string;
  quantity: number;
  /** Rupees as typed, so a half-typed price does not fight the input. */
  price: string;
  inStock: number;
}

export function BillBuilder({
  lines,
  paymentFeeBps,
}: {
  lines: InventoryLine[];
  /** Razorpay's cut in basis points, passed to the customer on a card payment. */
  paymentFeeBps: number;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [submitting, setSubmitting] = useState<PaymentMethod | null>(null);

  const inStock = useMemo(() => lines.filter((l) => l.quantity > 0), [lines]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inStock.slice(0, 12);
    return inStock
      .filter(
        (l) =>
          l.part_name.toLowerCase().includes(q) ||
          l.aliases.some((a) => a.toLowerCase().includes(q)) ||
          l.category.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [inStock, query]);

  const cartByPart = useMemo(() => new Map(cart.map((c) => [c.part_id, c])), [cart]);

  const addItem = useCallback((line: InventoryLine) => {
    setCart((current) => {
      const existing = current.find((c) => c.part_id === line.part_id);
      if (existing) {
        if (existing.quantity >= line.quantity) {
          toast.warning(`Only ${line.quantity} of ${line.part_name} in stock.`);
          return current;
        }
        return current.map((c) =>
          c.part_id === line.part_id ? { ...c, quantity: c.quantity + 1 } : c,
        );
      }
      return [
        ...current,
        {
          part_id: line.part_id,
          part_name: line.part_name,
          quantity: 1,
          price: (line.price_paise / 100).toFixed(0),
          inStock: line.quantity,
        },
      ];
    });
  }, []);

  const setQuantity = useCallback((partId: string, next: number) => {
    setCart((current) =>
      current.flatMap((c) => {
        if (c.part_id !== partId) return [c];
        if (next < 1) return [];
        return [{ ...c, quantity: Math.min(next, c.inStock) }];
      }),
    );
  }, []);

  const setPrice = useCallback((partId: string, price: string) => {
    setCart((current) => current.map((c) => (c.part_id === partId ? { ...c, price } : c)));
  }, []);

  const removeItem = useCallback((partId: string) => {
    setCart((current) => current.filter((c) => c.part_id !== partId));
  }, []);

  const totalPaise = cart.reduce((sum, c) => sum + rupeesToPaise(c.price) * c.quantity, 0);
  const unitCount = cart.reduce((sum, c) => sum + c.quantity, 0);
  const hasBadPrice = cart.some((c) => rupeesToPaise(c.price) <= 0);
  const disabled = submitting !== null || cart.length === 0 || totalPaise <= 0 || hasBadPrice;
  const processingFeePaise = Math.round((totalPaise * paymentFeeBps) / 10_000);

  const charge = useCallback(
    async (paymentMethod: PaymentMethod) => {
      setSubmitting(paymentMethod);
      try {
        const res = await fetch('/api/bills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payment_method: paymentMethod,
            lines: cart.map((c) => ({
              part_id: c.part_id,
              quantity: c.quantity,
              unit_price_paise: rupeesToPaise(c.price),
            })),
          }),
        });
        const body = (await res.json()) as { bill?: { id: string }; note?: string; error?: string };
        if (!res.ok || !body.bill) throw new Error(body.error ?? 'Could not open the bill.');

        toast.success(
          paymentMethod === 'cash' ? 'Cash bill recorded' : 'Bill created — show the QR',
          { description: body.note },
        );
        router.push(`/bills/${body.bill.id}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not open the bill.');
        setSubmitting(null);
      }
    },
    [cart, router],
  );

  if (inStock.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
        You have nothing in stock to sell. Add parts on the stock page first.
      </p>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
      {/* ---- Catalogue: tap to add ------------------------------------- */}
      <div className="space-y-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your stock, then tap to add"
            className="h-11 pl-9"
            aria-label="Search your stock"
          />
        </div>

        <ul className="grid gap-2 sm:grid-cols-2">
          {matches.map((line) => {
            const inCart = cartByPart.get(line.part_id);
            const maxed = (inCart?.quantity ?? 0) >= line.quantity;
            return (
              <li key={line.id}>
                <button
                  type="button"
                  onClick={() => addItem(line)}
                  disabled={maxed}
                  aria-label={`Add ${line.part_name} to the bill`}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors',
                    inCart ? 'border-brand/40 bg-brand-soft/50' : 'bg-card hover:bg-accent/40',
                    maxed && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{line.part_name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {line.quantity} in stock
                      {inCart ? ` · ${inCart.quantity} on this bill` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-medium tabular-nums">
                      {rupees(line.price_paise)}
                    </span>
                    <span
                      className={cn(
                        'grid size-6 place-items-center rounded-full',
                        inCart ? 'bg-brand text-brand-foreground' : 'bg-muted text-muted-foreground',
                      )}
                      aria-hidden
                    >
                      <Plus className="size-3.5" />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {matches.length === 0 ? (
            <li className="sm:col-span-2">
              <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing in your stock matches that.
              </p>
            </li>
          ) : null}
        </ul>
      </div>

      {/* ---- The bill --------------------------------------------------- */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-xl border bg-card">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <h2 className="text-sm font-semibold">
              Bill
              {unitCount > 0 ? (
                <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
                  {unitCount} {unitCount === 1 ? 'item' : 'items'}
                </span>
              ) : null}
            </h2>
            {cart.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setCart([])}>
                <X className="size-3.5" aria-hidden />
                Clear
              </Button>
            ) : null}
          </div>

          {cart.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Tap parts on the left to build the bill.
            </p>
          ) : (
            <ul className="divide-y">
              {cart.map((item) => {
                const linePaise = rupeesToPaise(item.price) * item.quantity;
                return (
                  <li key={item.part_id} className="space-y-2 px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-sm font-medium">{item.part_name}</p>
                      <button
                        type="button"
                        onClick={() => removeItem(item.part_id)}
                        aria-label={`Remove ${item.part_name} from the bill`}
                        className="text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          onClick={() => setQuantity(item.part_id, item.quantity - 1)}
                          aria-label={`One less ${item.part_name}`}
                        >
                          <Minus className="size-3" aria-hidden />
                        </Button>
                        <span className="w-7 text-center text-sm font-medium tabular-nums">
                          {item.quantity}
                        </span>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          onClick={() => setQuantity(item.part_id, item.quantity + 1)}
                          disabled={item.quantity >= item.inStock}
                          aria-label={`One more ${item.part_name}`}
                        >
                          <Plus className="size-3" aria-hidden />
                        </Button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">₹</span>
                        <Input
                          value={item.price}
                          onChange={(e) =>
                            setPrice(item.part_id, e.target.value.replace(/[^0-9.]/g, ''))
                          }
                          inputMode="decimal"
                          aria-label={`Unit price for ${item.part_name}`}
                          className="h-7 w-20 px-2 text-right text-sm tabular-nums"
                        />
                        <span className="w-16 text-right text-sm font-medium tabular-nums">
                          {rupees(linePaise)}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-3 border-t px-4 py-3">
            <div className="space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Parts</span>
                <span className="tabular-nums">{rupees(totalPaise)}</span>
              </div>
              {processingFeePaise > 0 ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Card fee ({(paymentFeeBps / 100).toFixed(1)}%)
                  </span>
                  <span className="tabular-nums">+{rupeesPrecise(processingFeePaise)}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between border-t pt-1.5">
                <span className="text-muted-foreground">
                  {processingFeePaise > 0 ? 'On card' : 'Total'}
                </span>
                <span className="text-xl font-semibold tabular-nums">
                  {rupees(totalPaise + processingFeePaise)}
                </span>
              </div>
              {processingFeePaise > 0 ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">In cash</span>
                  <span className="tabular-nums">{rupees(totalPaise)}</span>
                </div>
              ) : null}
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={() => void charge('razorpay')}
              disabled={disabled}
            >
              {submitting === 'razorpay' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <QrCode className="size-4" aria-hidden />
              )}
              Pay through Razorpay
            </Button>

            <Button
              className="w-full"
              size="lg"
              variant="outline"
              onClick={() => void charge('cash')}
              disabled={disabled}
            >
              {submitting === 'cash' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Banknote className="size-4" aria-hidden />
              )}
              Cash received
            </Button>

            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Razorpay</span> shows a QR for the whole
              bill; stock comes off the shelf after you confirm handover.{' '}
              <span className="font-medium text-foreground">Cash</span> books the sale and cuts stock
              straight away — with cash the money and the parts change hands together, and there is no
              card fee to pass on.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
