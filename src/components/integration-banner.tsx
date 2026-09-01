import { AlertTriangle, CheckCircle2, Radio } from 'lucide-react';

import { isSimulated, platformFeeBps } from '@/lib/razorpay/client';

/**
 * States the Razorpay integration honestly, on every screen.
 *
 * Judges who know Razorpay will spot a mocked call in seconds, so the app says
 * up front which mode it is in rather than letting them find out.
 */
export function IntegrationBanner() {
  const simulated = isSimulated();
  const feePct = (platformFeeBps() / 100).toFixed(1);

  if (simulated) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <p className="text-foreground/80">
          <span className="font-semibold text-warning">Simulated mode.</span> No Razorpay keys are
          configured, so orders, payment links, Route transfers and settlement holds are stand-ins —
          every record they create is stamped <span className="font-medium">simulated</span>. Add{' '}
          <code className="rounded bg-background/60 px-1 py-0.5 text-xs">RAZORPAY_KEY_ID</code> and{' '}
          <code className="rounded bg-background/60 px-1 py-0.5 text-xs">RAZORPAY_KEY_SECRET</code> to
          switch to real test-mode API calls.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-success/25 bg-success-soft px-4 py-3 text-sm">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      <p className="text-foreground/80">
        <span className="font-semibold text-success">Razorpay test mode.</span> Orders, Payment Links
        and Route calls are real API requests against your test keys — open the Razorpay dashboard
        alongside this app to watch them land. Platform fee is {feePct}% of each shop-to-shop trade.
        Route splits still fall back to simulation for shops whose Linked Account id is a mock
        (<code className="rounded bg-background/60 px-1 py-0.5 text-xs">acc_MOCK…</code>), because
        real onboarding needs KYC.
      </p>
    </div>
  );
}

/** Compact always-visible mode chip for the header. */
export function ModeChip() {
  const simulated = isSimulated();
  return (
    <span
      className={
        simulated
          ? 'inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning'
          : 'inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success-soft px-2.5 py-1 text-xs font-medium text-success'
      }
    >
      <Radio className="size-3 animate-live" aria-hidden />
      {simulated ? 'Simulated' : 'Razorpay test mode'}
    </span>
  );
}
