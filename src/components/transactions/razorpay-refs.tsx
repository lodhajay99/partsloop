'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/**
 * The Razorpay ids behind this transaction, copyable.
 *
 * These exist so anyone can paste an id into the Razorpay test dashboard and
 * confirm the record is really there. Ids prefixed SIM/SEED never touched
 * Razorpay and say so.
 */
export function RazorpayRefs({
  refs,
}: {
  refs: Array<{ label: string; value: string | null; hint?: string }>;
}) {
  const shown = refs.filter((r) => r.value);
  if (shown.length === 0) return null;

  return (
    <dl className="space-y-2">
      {shown.map((ref) => (
        <RefRow key={ref.label} label={ref.label} value={ref.value!} hint={ref.hint} />
      ))}
    </dl>
  );
}

function RefRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  const fake = /SIM|SEED/.test(value);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <dt className="w-32 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{value}</code>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        </button>
        {fake ? (
          <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">
            not a real Razorpay id
          </span>
        ) : null}
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  );
}
