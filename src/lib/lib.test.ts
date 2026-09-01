/**
 * Unit tests for the pure logic — `npm run test`.
 *
 * Scope is deliberately narrow: the webhook signature check (the one place a
 * bug lets a stranger write to the ledger), the money arithmetic, and the
 * simulated/mock detection that decides whether the UI is allowed to claim a
 * payment was real. Everything else needs a database and is covered by
 * `npm run db:verify`.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';

import {
  appUrl,
  isMockLinkedAccount,
  isSimulated,
  platformFeeBps,
  platformFeePaise,
  razorpayMode,
  verifyWebhookSignature,
} from '@/lib/razorpay/client';
import { freshnessTone, monthRange, relativeTime, rupees, rupeesToPaise } from '@/lib/format';
import { monthParam, parseMonthParam } from '@/lib/data/dashboard';

const SECRET = 'test_webhook_secret';

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('webhook signature', () => {
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1' } } } });

  it('accepts a signature made with the configured secret', () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    assert.equal(verifyWebhookSignature(body, sign(body)), true);
  });

  it('rejects a signature made with a different secret', () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    assert.equal(verifyWebhookSignature(body, sign(body, 'wrong_secret')), false);
  });

  it('rejects a signature for different bytes', () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    assert.equal(verifyWebhookSignature(`${body} `, sign(body)), false);
  });

  it('rejects a missing signature header', () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    assert.equal(verifyWebhookSignature(body, null), false);
  });

  it('rejects everything when no secret is configured', () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    assert.equal(verifyWebhookSignature(body, sign(body)), false);
  });

  it('rejects a truncated signature without throwing', () => {
    // timingSafeEqual throws on length mismatch, so the length guard matters.
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    assert.equal(verifyWebhookSignature(body, sign(body).slice(0, 20)), false);
    assert.equal(verifyWebhookSignature(body, ''), false);
  });
});

describe('mode detection', () => {
  it('is simulated with no keys and test with both', () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    assert.equal(razorpayMode(), 'simulated');
    assert.equal(isSimulated(), true);

    process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
    process.env.RAZORPAY_KEY_SECRET = 'secret';
    assert.equal(razorpayMode(), 'test');
    assert.equal(isSimulated(), false);
  });

  it('treats a half-configured pair as simulated rather than half-real', () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
    delete process.env.RAZORPAY_KEY_SECRET;
    assert.equal(razorpayMode(), 'simulated');
  });

  it('flags mock and missing Route Linked Accounts', () => {
    assert.equal(isMockLinkedAccount('acc_MOCK0000000001'), true);
    assert.equal(isMockLinkedAccount(null), true);
    assert.equal(isMockLinkedAccount(undefined), true);
    assert.equal(isMockLinkedAccount(''), true);
    assert.equal(isMockLinkedAccount('acc_QKt9nB2xYz1234'), false);
  });
});

describe('platform fee', () => {
  it('defaults to 2%', () => {
    delete process.env.PLATFORM_FEE_BPS;
    assert.equal(platformFeeBps(), 200);
    assert.equal(platformFeePaise(248000), 4960);
  });

  it('honours a configured basis-point value', () => {
    process.env.PLATFORM_FEE_BPS = '350';
    assert.equal(platformFeeBps(), 350);
    assert.equal(platformFeePaise(100000), 3500);
  });

  it('falls back to the default on nonsense or blank input', () => {
    for (const bad of ['abc', '-1', '20000', '', '   ']) {
      process.env.PLATFORM_FEE_BPS = bad;
      assert.equal(platformFeeBps(), 200, `for ${JSON.stringify(bad)}`);
    }
  });

  it('honours an explicit zero fee', () => {
    process.env.PLATFORM_FEE_BPS = '0';
    assert.equal(platformFeeBps(), 0);
    assert.equal(platformFeePaise(248000), 0);
  });

  it('never charges more than the transaction', () => {
    process.env.PLATFORM_FEE_BPS = '200';
    for (const amount of [1, 99, 100, 12345, 9_999_999]) {
      const fee = platformFeePaise(amount);
      assert.ok(fee >= 0 && fee <= amount, `fee ${fee} for amount ${amount}`);
    }
    delete process.env.PLATFORM_FEE_BPS;
  });
});

describe('money formatting', () => {
  it('renders paise as whole rupees', () => {
    assert.match(rupees(248000), /2,480/);
    assert.match(rupees(0), /0/);
  });

  it('round-trips rupee input to paise', () => {
    assert.equal(rupeesToPaise('2480'), 248000);
    assert.equal(rupeesToPaise('2480.50'), 248050);
    assert.equal(rupeesToPaise('₹2,480'), 248000);
    assert.equal(rupeesToPaise(2480), 248000);
  });

  it('treats junk and negatives as zero rather than NaN', () => {
    assert.equal(rupeesToPaise('abc'), 0);
    assert.equal(rupeesToPaise(''), 0);
    assert.equal(rupeesToPaise(-5), 0);
  });
});

describe('freshness', () => {
  const now = new Date('2026-08-30T12:00:00Z');
  const ago = (mins: number) => new Date(now.getTime() - mins * 60_000).toISOString();

  it('describes age in the units a shop owner would use', () => {
    assert.equal(relativeTime(ago(0), now), 'just now');
    assert.equal(relativeTime(ago(14), now), '14 min ago');
    assert.equal(relativeTime(ago(60), now), '1 hour ago');
    assert.equal(relativeTime(ago(60 * 5), now), '5 hours ago');
    assert.equal(relativeTime(ago(60 * 24), now), '1 day ago');
    assert.equal(relativeTime(ago(60 * 24 * 3), now), '3 days ago');
  });

  it('grades stock listings by how recently they were confirmed', () => {
    assert.equal(freshnessTone(ago(10), now), 'fresh');
    assert.equal(freshnessTone(ago(60 * 5), now), 'fresh');
    assert.equal(freshnessTone(ago(60 * 20), now), 'ok');
    assert.equal(freshnessTone(ago(60 * 72), now), 'stale');
  });
});

describe('month range', () => {
  it('covers the whole calendar month as a half-open interval', () => {
    const { start, end } = monthRange(new Date(2026, 7, 30, 15, 30));
    assert.equal(start.getMonth(), 7);
    assert.equal(start.getDate(), 1);
    assert.equal(start.getHours(), 0);
    assert.equal(end.getMonth(), 8);
    assert.equal(end.getDate(), 1);
  });

  it('rolls over correctly in December', () => {
    const { start, end } = monthRange(new Date(2026, 11, 25));
    assert.equal(start.getFullYear(), 2026);
    assert.equal(start.getMonth(), 11);
    assert.equal(end.getFullYear(), 2027);
    assert.equal(end.getMonth(), 0);
  });
});

describe('public origin', () => {
  const VERCEL_VARS = ['VERCEL_ENV', 'VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL'];

  function clear() {
    delete process.env.NEXT_PUBLIC_APP_URL;
    for (const v of VERCEL_VARS) delete process.env[v];
  }

  it('prefers an explicit NEXT_PUBLIC_APP_URL and trims the trailing slash', () => {
    clear();
    process.env.NEXT_PUBLIC_APP_URL = 'https://partloop.example.com/';
    assert.equal(appUrl(), 'https://partloop.example.com');
  });

  it("uses Vercel's production host when nothing is set", () => {
    clear();
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'partloop.vercel.app';
    process.env.VERCEL_URL = 'partloop-abc123.vercel.app';
    assert.equal(appUrl(), 'https://partloop.vercel.app');
  });

  it('uses the per-deployment host on a preview build', () => {
    clear();
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'partloop.vercel.app';
    process.env.VERCEL_URL = 'partloop-abc123.vercel.app';
    assert.equal(appUrl(), 'https://partloop-abc123.vercel.app');
  });

  it('never emits a bare host or a doubled scheme', () => {
    clear();
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'https://partloop.vercel.app/';
    assert.equal(appUrl(), 'https://partloop.vercel.app');
  });

  it('falls back to localhost only when there is no Vercel host either', () => {
    clear();
    assert.equal(appUrl(), 'http://localhost:3000');
  });

  it('treats a blank NEXT_PUBLIC_APP_URL as unset rather than as an origin', () => {
    // A `NEXT_PUBLIC_APP_URL=` line on Vercel would otherwise produce callbacks
    // pointing at the empty string.
    clear();
    process.env.NEXT_PUBLIC_APP_URL = '   ';
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'partloop.vercel.app';
    assert.equal(appUrl(), 'https://partloop.vercel.app');
  });
});

describe('dashboard month selection', () => {
  const now = new Date(2026, 8, 1); // 1 Sep 2026 — the rollover that started this

  it('round-trips a month through the query param', () => {
    assert.equal(monthParam(new Date(2026, 7, 1)), '2026-08');
    assert.equal(monthParam(new Date(2026, 11, 1)), '2026-12');
    assert.deepEqual(parseMonthParam('2026-08', now), new Date(2026, 7, 1));
  });

  it('accepts the current month', () => {
    assert.deepEqual(parseMonthParam('2026-09', now), new Date(2026, 8, 1));
  });

  it('refuses a future month — there are no books to read yet', () => {
    assert.equal(parseMonthParam('2026-10', now), null);
    assert.equal(parseMonthParam('2027-01', now), null);
  });

  it('refuses anything malformed rather than producing an Invalid Date', () => {
    for (const bad of ['', 'august', '2026-13', '2026-00', '26-08', '2026/08', '2026-8']) {
      assert.equal(parseMonthParam(bad, now), null, `for ${JSON.stringify(bad)}`);
    }
    assert.equal(parseMonthParam(undefined, now), null);
  });
});
