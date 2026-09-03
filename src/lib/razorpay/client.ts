import 'server-only';

import crypto from 'node:crypto';

/**
 * Thin typed wrapper over the Razorpay REST API (test mode).
 *
 * We call the REST endpoints directly rather than through the Node SDK because
 * this app uses Route endpoints — payment transfers and the Settlement Hold
 * PATCH — and hand-rolling the four calls we need is clearer than working
 * around SDK coverage gaps.
 *
 * SIMULATED MODE
 * If RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are absent, every function below
 * returns a synthetic response with a `_simulated: true` marker instead of
 * throwing, and payment links point at the in-app simulator (/simulate/pay/:id).
 * That keeps the whole product walkable with zero credentials — but every
 * simulated record is flagged in the database (transactions.simulated) and
 * rendered with a visible "simulated" badge. Nothing silently pretends to be a
 * real payment.
 */

const API_BASE = 'https://api.razorpay.com/v1';

export type RazorpayMode = 'test' | 'simulated';

export function razorpayMode(): RazorpayMode {
  return process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET ? 'test' : 'simulated';
}

export function isSimulated(): boolean {
  return razorpayMode() === 'simulated';
}

/**
 * Route Linked Accounts require KYC we did not do for the hackathon, so seeded
 * shops carry `acc_MOCK*` ids. A transfer against one of those cannot be real.
 */
export function isMockLinkedAccount(accountId: string | null | undefined): boolean {
  return !accountId || accountId.startsWith('acc_MOCK');
}

/**
 * The public origin, used to build Razorpay callback URLs.
 *
 * Order matters. An explicit NEXT_PUBLIC_APP_URL always wins (custom domains).
 * Otherwise fall back to the host Vercel injects, because the alternative — a
 * deployment quietly sending customers a callback to http://localhost:3000 —
 * is broken in a way nothing surfaces until someone pays.
 *
 * VERCEL_PROJECT_PRODUCTION_URL is the stable production host;
 * VERCEL_URL is the per-deployment host, which is what preview builds want.
 */
export function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const vercelHost =
    process.env.VERCEL_ENV === 'production'
      ? (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL)
      : (process.env.VERCEL_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL);

  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

  return 'http://localhost:3000';
}

export function platformFeeBps(): number {
  // An empty or blank PLATFORM_FEE_BPS= line is a misconfiguration, not a
  // deliberate 0% fee — Number('') is 0, which would silently waive the fee.
  // An explicit "0" still means zero.
  const raw = process.env.PLATFORM_FEE_BPS?.trim();
  if (!raw) return 200;

  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 10_000 ? value : 200;
}

/** Platform's cut, in paise. Basis points of the gross amount. */
export function platformFeePaise(amountPaise: number): number {
  return Math.round((amountPaise * platformFeeBps()) / 10_000);
}

export class RazorpayError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = 'RazorpayError';
    this.status = status;
    this.body = body;
  }
}

async function rzp<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new RazorpayError(0, null, 'Razorpay keys are not configured.');
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const description =
      (parsed as { error?: { description?: string } } | null)?.error?.description ??
      `Razorpay ${init.method} ${path} failed with ${res.status}`;
    throw new RazorpayError(res.status, parsed, description);
  }

  return parsed as T;
}

// ---------------------------------------------------------------------------
// Types (only the fields this app reads)
// ---------------------------------------------------------------------------

export interface RouteTransferSpec {
  account: string;
  amount: number;
  currency: 'INR';
  notes?: Record<string, string>;
  on_hold?: boolean;
  on_hold_until?: number | null;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status: string;
  _simulated?: boolean;
}

export interface RazorpayPaymentLink {
  id: string;
  short_url: string;
  status: string;
  amount: number;
  order_id?: string | null;
  payments?: Array<{ payment_id: string; status: string; amount: number }> | null;
  _simulated?: boolean;
}

export interface RazorpayTransfer {
  id: string;
  source?: string;
  recipient: string;
  amount: number;
  on_hold: boolean;
  on_hold_until: number | null;
  status?: string;
  _simulated?: boolean;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function createOrder(input: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
  transfers?: RouteTransferSpec[];
}): Promise<RazorpayOrder> {
  if (isSimulated()) {
    return {
      id: `order_SIM${randomSuffix()}`,
      amount: input.amountPaise,
      currency: 'INR',
      receipt: input.receipt,
      status: 'created',
      _simulated: true,
    };
  }

  return rzp<RazorpayOrder>('/orders', {
    method: 'POST',
    body: {
      amount: input.amountPaise,
      currency: 'INR',
      receipt: input.receipt,
      notes: input.notes,
      ...(input.transfers?.length ? { transfers: input.transfers } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Payment Links
// ---------------------------------------------------------------------------

/**
 * Creates a Payment Link. When `transfers` is supplied, the split is attached
 * via `options.order.transfers` — that is how Route works with Payment Links;
 * there is no top-level `transfers` field on this endpoint. Razorpay creates
 * the transfers itself when the payment is captured, already `on_hold`.
 */
export async function createPaymentLink(input: {
  amountPaise: number;
  description: string;
  referenceId: string;
  callbackUrl: string;
  notes?: Record<string, string>;
  transfers?: RouteTransferSpec[];
  simulatorUrl?: string;
}): Promise<RazorpayPaymentLink> {
  if (isSimulated()) {
    return {
      id: `plink_SIM${randomSuffix()}`,
      short_url: input.simulatorUrl ?? input.callbackUrl,
      status: 'created',
      amount: input.amountPaise,
      order_id: `order_SIM${randomSuffix()}`,
      _simulated: true,
    };
  }

  return rzp<RazorpayPaymentLink>('/payment_links', {
    method: 'POST',
    body: {
      amount: input.amountPaise,
      currency: 'INR',
      accept_partial: false,
      description: input.description.slice(0, 2048),
      reference_id: input.referenceId,
      callback_url: input.callbackUrl,
      callback_method: 'get',
      reminder_enable: false,
      notify: { sms: false, email: false },
      notes: input.notes,
      ...(input.transfers?.length ? { options: { order: { transfers: input.transfers } } } : {}),
    },
  });
}

export async function fetchPaymentLink(id: string): Promise<RazorpayPaymentLink> {
  return rzp<RazorpayPaymentLink>(`/payment_links/${id}`, { method: 'GET' });
}

// ---------------------------------------------------------------------------
// Route transfers + Settlement Hold
// ---------------------------------------------------------------------------

export async function fetchPaymentTransfers(paymentId: string): Promise<RazorpayTransfer[]> {
  const res = await rzp<{ items: RazorpayTransfer[] }>(`/payments/${paymentId}/transfers`, {
    method: 'GET',
  });
  return res.items ?? [];
}

/** Direct transfer on a captured payment — the fallback when the order-level split did not run. */
export async function createPaymentTransfer(
  paymentId: string,
  transfers: RouteTransferSpec[],
): Promise<RazorpayTransfer[]> {
  const res = await rzp<{ items: RazorpayTransfer[] }>(`/payments/${paymentId}/transfers`, {
    method: 'POST',
    body: { transfers },
  });
  return res.items ?? [];
}

/**
 * Settlement Hold. `on_hold: true` parks the seller's money with Razorpay
 * instead of settling it; `false` releases it on the next settlement cycle.
 *
 * NOTE: this is an escrow-*like* pattern built on Route's settlement controls.
 * It is not a licensed escrow product — see the README.
 */
export async function setTransferHold(
  transferId: string,
  onHold: boolean,
  onHoldUntil?: Date | null,
): Promise<RazorpayTransfer> {
  return rzp<RazorpayTransfer>(`/transfers/${transferId}`, {
    method: 'PATCH',
    body: onHold
      ? {
          on_hold: true,
          ...(onHoldUntil ? { on_hold_until: Math.floor(onHoldUntil.getTime() / 1000) } : {}),
        }
      : { on_hold: false },
  });
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
  _simulated?: boolean;
}

/**
 * Refunds a captured payment in full.
 *
 * `speed: 'normal'` rather than 'optimum': optimum attempts an instant refund
 * and costs extra, and a shop cancelling a mistaken bill has no reason to pay
 * for speed. Test mode refunds settle immediately either way.
 */
export async function refundPayment(input: {
  paymentId: string;
  amountPaise: number;
  notes?: Record<string, string>;
}): Promise<RazorpayRefund> {
  if (isSimulated()) {
    return {
      id: `rfnd_SIM${randomSuffix()}`,
      payment_id: input.paymentId,
      amount: input.amountPaise,
      status: 'processed',
      _simulated: true,
    };
  }

  return rzp<RazorpayRefund>(`/payments/${input.paymentId}/refund`, {
    method: 'POST',
    body: {
      amount: input.amountPaise,
      speed: 'normal',
      notes: input.notes,
    },
  });
}

// ---------------------------------------------------------------------------
// Webhook signature
// ---------------------------------------------------------------------------

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function randomSuffix(): string {
  return crypto.randomBytes(7).toString('hex');
}
