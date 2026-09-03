import type { CheckoutHandle } from '@/types/db';

/**
 * Opens Razorpay Checkout in the page.
 *
 * Why Checkout rather than a Payment Link: a Razorpay test account can create
 * only 30 Payment Links in its entire lifetime, and cancelling old ones does
 * not return the slot. This app hit that ceiling and every payment stopped —
 * both the shop-to-shop reservation and the counter bill went through a link.
 * Orders have no such cap, and Checkout pays an order directly.
 *
 * It is also a better counter experience: no popup to be blocked, no bounce to
 * an external page, and the UPI tab shows a QR the walk-in customer can scan
 * off the shopkeeper's screen.
 *
 * Nothing here is trusted. Checkout's success callback is only a hint that it
 * is worth asking the server; the server confirms the capture with Razorpay
 * before a single row moves.
 */

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayCheckoutInstance {
  open: () => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
}

type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayCheckoutInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let loader: Promise<RazorpayConstructor> | null = null;

function loadCheckout(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);

  // One shared load. Two buttons pressed quickly must not inject two scripts.
  loader ??= new Promise<RazorpayConstructor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement('script');

    script.addEventListener('load', () => {
      if (window.Razorpay) resolve(window.Razorpay);
      else reject(new Error('Razorpay Checkout loaded but did not start.'));
    });
    script.addEventListener('error', () => {
      loader = null; // a dropped connection should not poison every later attempt
      reject(new Error('Could not reach Razorpay Checkout. Check the connection.'));
    });

    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      document.body.appendChild(script);
    }
  });

  return loader;
}

export interface CheckoutOutcome {
  /** The customer completed Checkout. Still unconfirmed until the server says so. */
  paid: boolean;
  /** They closed the sheet without paying — not an error, so do not shout about it. */
  dismissed: boolean;
  error: string | null;
}

export async function openCheckout(input: {
  handle: CheckoutHandle;
  name: string;
  description: string;
  prefillContact?: string | null;
}): Promise<CheckoutOutcome> {
  const Razorpay = await loadCheckout();

  return new Promise<CheckoutOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: CheckoutOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const checkout = new Razorpay({
      key: input.handle.key_id,
      order_id: input.handle.order_id,
      amount: input.handle.amount_paise,
      currency: 'INR',
      name: input.name,
      description: input.description,
      // Razorpay retries its own callback; we confirm server-side regardless.
      handler: () => settle({ paid: true, dismissed: false, error: null }),
      modal: {
        ondismiss: () => settle({ paid: false, dismissed: true, error: null }),
        escape: true,
      },
      prefill: input.prefillContact ? { contact: input.prefillContact } : undefined,
      theme: { color: '#ea580c' },
    });

    checkout.on('payment.failed', (payload: unknown) => {
      const description = (payload as { error?: { description?: string } } | undefined)?.error
        ?.description;
      settle({ paid: false, dismissed: false, error: description ?? 'Razorpay declined the payment.' });
    });

    checkout.open();
  });
}
