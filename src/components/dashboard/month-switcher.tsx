import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { monthParam } from '@/lib/data/dashboard';
import { cn } from '@/lib/utils';

/**
 * Month navigation for the ledger.
 *
 * Plain links, no client JS — the dashboard is a server component and the month
 * is just a query param, so back/forward and a shared URL all behave.
 *
 * Forward is capped at the current month: there are no future books to read.
 */
export function MonthSwitcher({
  month: current,
  now = new Date(),
}: {
  /** First day of the month being shown. Not named `ref` — React reserves that. */
  month: Date;
  now?: Date;
}) {
  const prev = new Date(current.getFullYear(), current.getMonth() - 1, 1);
  const next = new Date(current.getFullYear(), current.getMonth() + 1, 1);

  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const atCurrentMonth = current.getTime() >= thisMonth.getTime();

  return (
    <div className="flex items-center gap-1">
      <Link
        href={`/dashboard?month=${monthParam(prev)}`}
        aria-label={`Previous month, ${prev.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`}
        className="grid size-7 place-items-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
      </Link>

      {atCurrentMonth ? (
        <span
          aria-disabled
          title="This is the current month — there are no later books yet."
          className="grid size-7 cursor-not-allowed place-items-center rounded-md border text-muted-foreground/40"
        >
          <ChevronRight className="size-4" aria-hidden />
        </span>
      ) : (
        <Link
          href={`/dashboard?month=${monthParam(next)}`}
          aria-label={`Next month, ${next.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`}
          className="grid size-7 place-items-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      )}

      {!atCurrentMonth ? (
        <Link
          href="/dashboard"
          className={cn(
            'ml-1 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground',
            'transition-colors hover:bg-accent hover:text-foreground',
          )}
        >
          Latest
        </Link>
      ) : null}
    </div>
  );
}
