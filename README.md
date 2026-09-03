# PartLoop

**One ledger for every sale — the walk-in customer and the shop down the road.**

A web app for independent auto spare-parts shops. Every shop gets a free daily sales ledger and a
monthly dashboard, useful even if they are the only shop using it. On top of that, a shop can search
whether a part it does not stock is available at another shop nearby *right now*, reserve it, and pay
for it.

Both kinds of money movement — a counter sale to a walk-in customer, and a shop-to-shop stock
purchase — land in the same `transactions` table. That is the whole idea: **one ledger, and no second
bookkeeping system to keep in sync.**

Razorpay is the default and does the heavy lifting: every digital sale is a real charge, so the
monthly books fall out of the payment records for free and each row reconciles to a payment id. Cash
is supported too, because a shop takes cash all day and refusing to bill it would just push the
shopkeeper back to a paper record — but a cash bill has no payment record behind it, so it is tagged
in the database, badged `cash` everywhere it appears, and counted separately on the dashboard. The
claim stays precise: anything charged through Razorpay reconciles, and anything that did not says so
on its face.

Built for the Razorpay Buildathon 2026. **Test mode only.**

---

## What is real and what is not

Judges who know Razorpay will spot a mocked call in seconds, so here it is up front. The app also
says all of this on screen, on every page — see `src/components/integration-banner.tsx`.

| Thing | Status |
| --- | --- |
| Orders API (`POST /v1/orders`) | **Real** REST call with your test keys |
| Payment Links API (`POST /v1/payment_links`) | **Real** |
| Payment Link status read (`GET /v1/payment_links/:id`) | **Real** — this is how the app reconciles without a public webhook URL |
| Webhook signature verification (HMAC-SHA256) | **Real**, and unit-tested |
| Route split via `options.order.transfers` | **Real API call**, but see the Linked Account row below |
| Route transfer read/create (`/v1/payments/:id/transfers`) | **Real** |
| Settlement Hold (`PATCH /v1/transfers/:id`, `on_hold`) | **Real** |
| **Route Linked Account onboarding** | **Simulated.** Real onboarding needs KYC that cannot be done in a hackathon. The six seeded shops carry `acc_MOCK…` ids, and any transfer against one of those is recorded with `simulated = true` and rendered with a visible `simulated` badge. Replace the ids in `shops.razorpay_linked_account_id` with real `acc_…` ids and the same code path goes live with no changes. |
| **Seeded ledger history** | **Simulated.** The ~380 backdated counter bills (and their ~750 line items) that make the dashboard look alive on first load were never charged; they are marked `is_seed = true` and badged `seed` in the UI. Everything you create during a demo is real. |
| Escrow | **Not escrow.** The hold/release flow is an escrow-*like* pattern built on Route's settlement controls. Razorpay's actual escrow product requires bank-partner approval. The app never uses the word "escrow" in its UI. |
| **Cash sales** | **No Razorpay record, by design.** Cash goes straight into the till, so a cash bill carries no order/payment id and never pretends to. It is tagged `payment_method = 'cash'`, badged in the UI, and split out on the counter board. A database constraint stops a cash bill from sitting in an unpaid state. |
| Auth | **Demo shop picker, not phone OTP.** See [Authentication](#authentication). |

Running with **no Razorpay keys at all** is also supported: the app drops into a clearly-labelled
simulated mode where every payment link points at an in-app stand-in (`/simulate/pay/:id`). That
exists so the product can be reviewed before credentials are wired up. It refuses to run the moment
real keys are present, so it can never be used to fake a payment that should have gone through
Razorpay.

---

## Running it

### Option A — fully local (needs Docker)

Nothing to sign up for. `supabase/config.toml` is checked in, with realtime, storage, edge
functions and analytics switched off so the stack boots with only the containers this app uses.

```bash
npm install
npx supabase start          # Postgres + PostgREST + Studio; applies migrations and seed.sql
npm run env:local           # writes .env.local from the running stack
npm run dev
```

`npm run env:local` reads the URL and keys `supabase start` printed and fills in the Supabase half
of `.env.local`, leaving any Razorpay keys already there alone. Razorpay keys are optional; without
them the app runs in labelled simulated mode and the whole flow is still walkable — including
payment capture, the Route split arithmetic, the settlement hold and the release.

Useful afterwards:

```bash
npx supabase status         # ports and keys again
npx supabase db reset       # re-run migrations + reseed
npx supabase stop           # shut the containers down
```

Studio (browse the tables directly) is at http://localhost:54323.

### Option B — Supabase cloud

Create a project, then put the project URL and the `service_role` key in `.env.local` as
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Then load the schema, either way:

**Paste one file (no password needed).**

```bash
npm run db:bundle       # writes supabase/bundle.sql — every migration + the seed, in order
```

Paste it into the dashboard's SQL Editor and run it once. This is the reliable path: new Supabase
projects resolve their direct database host over IPv6 only and plenty of networks cannot reach it.

**Or connect directly**, by also setting `SUPABASE_DB_URL` to the *Postgres* connection string from
Project Settings → Database (the **Session pooler** URI — this is not the REST API URL, which lives
one settings page away and is easy to grab by mistake):

```bash
npm run db:inspect      # read-only: what is already in that database
npm run db:push && npm run db:seed
```

Either way, open http://localhost:3000 and pick **Shree Auto Spares**.

> Rollback scripts live in `supabase/migrations/down/`, deliberately out of `supabase/migrations/`
> — the Supabase CLI applies every `.sql` file it finds there, and a stray `*.down.sql` in the apply
> path would drop the schema on `supabase start`. `npm run db:reset` still runs them in reverse.

### Razorpay (optional)

Grab **test-mode** keys from
[dashboard.razorpay.com/app/website-app-settings/api-keys](https://dashboard.razorpay.com/app/website-app-settings/api-keys)
(Dashboard → Account & Settings → API Keys, with the **Test Mode** toggle on — the key id starts
`rzp_test_`). The secret is shown once, at generation time.

Add them to `.env.local` yourself and restart `npm run dev`:

```bash
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your-test-secret
```

The amber "Simulated mode" banner turns into a green "Razorpay test mode" one, and the in-app
payment simulator refuses to run from then on.

#### Sharing one test key with another project

Razorpay keys are **per account and per mode**, not per project, so reusing the same `rzp_test_` pair
across apps is fine and normal. Two things to know:

- **Records interleave.** Both projects' orders and payments land in the same test dashboard.
  PartLoop stamps `notes.partloop_bill_id` / `notes.partloop_transaction_id` on everything it
  creates, so its own rows are easy to pick out.
- **Webhooks need their own endpoint.** A webhook is configured per URL with its own secret, so
  **add a second endpoint** for PartLoop rather than editing the one the other project uses — editing
  it would break that project. If both endpoints are live, each app receives events for the other's
  payments; PartLoop's handler answers `{ok: true, ignored: "no matching transaction"}` for anything
  it does not recognise and never touches the ledger, so the crosstalk is harmless in this direction.

Webhook setup, when you want it: Settings → Webhooks → point at
`https://<your-deployment>/api/razorpay/webhook`, subscribe to `payment.captured` and
`payment_link.paid`, and set `RAZORPAY_WEBHOOK_SECRET` to that endpoint's secret.

**On localhost a webhook cannot reach you at all**, so it is genuinely optional. Rather than
pretending otherwise, the bill and transaction pages have a **"check Razorpay"** button that calls
`GET /v1/payment_links/:id` and fulfils from Razorpay's own answer. Same fulfilment code, same
idempotency — pulled instead of pushed.

---

## The demo, in about three minutes

1. **Dashboard for Shree Auto Spares.** This month's revenue split by counter sales vs sold-to-shops
   vs bought-from-shops, a Walk-in counter board, a day-by-day chart, low-stock flags, and the full
   transaction table — all from `transactions` and nothing else.
2. **Ring up a live bill.** Tap three parts onto the bill — including two of one — and charge the
   lot. One Razorpay Payment Link and QR appear for the total; pay it with a test card. The bill
   flips to *paid, stock still on shelf*; tap **Cut stock for these items** and watch the quantities
   drop. It lands on the Walk-in counter board immediately, and the payment id is in the Razorpay
   test dashboard.
3. **Now the cash case.** Build another bill and hit **Cash received** instead. It books the sale
   and cuts stock in one step, badges itself `cash`, and states plainly that there is no Razorpay
   record behind it — while the board's Razorpay/cash split moves.
4. **Search for a part Shree does not have** — type `i20 brek pad`, misspelled. Trigram matching
   resolves it, and the map lights up with the shops that do have it: distance, quantity, price,
   "verified 14 min ago". **Names and exact locations are hidden** — dashed circles, "Shop B".
5. **Reserve.** Stock is held for 30 minutes and the seller is revealed: name, address, phone, exact
   pin.
6. **Pay.** A Payment Link with a Route split: seller's share to their Linked Account, 2% platform
   fee retained, transfer created `on_hold`. Watch it appear in the Razorpay dashboard.
7. **Mark received.** The Settlement Hold is released. Watch `on_hold` flip to `false` live.
8. **Switch to the seller's shop.** The sale they just made to Shree is already in their monthly
   ledger. One Razorpay-powered ledger, whether the sale was to a customer or to another shop.

---

## How it works

### Feature 1 — cross-shop search, reserve, pay

**Fuzzy matching.** Shop owners type `swift brek ped`, not `Maruti Swift 2015-2019 Front Brake Pad
Set`. `search_available_parts()` (in `supabase/migrations/0004_search_functions.sql`) scores each
part by the best of four signals: whole-string trigram `similarity()`, `word_similarity()` (so a
short query still scores against a long catalog name), and substring hits on the canonical name and
on the flattened alias text. It then joins to in-stock inventory at *other* shops, filters by
Haversine distance, and keeps only rows scoring near the best match — an absolute threshold alone
lets "i20 brake pad" drag in every brake pad in the catalog, because "brake pad" genuinely does
partially match all of them.

**Privacy.** Sellers are anonymous until a buyer commits. The masking happens **server-side** in
`src/lib/data/search.ts`: for unreserved rows the shop name, address and id are stripped before the
response leaves the process, and coordinates are replaced with a deterministic ~200–450 m offset
drawn as a dashed circle. The browser is never sent the data, so it cannot un-hide it. Reserving is
keyed off the opaque `inventory_id` precisely because the client does not know who it is reserving
from.

**Reserve → pay → hold → release.**

1. Reserve → a `transactions` row, `status = 'reserved'`, `hold_until = now() + 30 min`.
2. Pay → a Razorpay Order and a Payment Link carrying `options.order.transfers` — the seller's
   share to their Linked Account, created `on_hold: true`.
3. On capture (webhook, or the reconcile poll) → status `on_hold`, seller's stock decremented, and
   the transfer confirmed held. If Razorpay created no transfer, one is created directly on the
   payment; if that is impossible (mock Linked Account), a clearly-marked simulated transfer id is
   recorded and the reason is shown on screen.
4. Mark received → `PATCH /v1/transfers/:id` with `on_hold: false`, status `released`.
5. Reservations past `hold_until` flip to `expired` — swept on page load rather than by a cron job,
   which is the honest hackathon trade-off.

### Feature 2 — counter bills + monthly dashboard

**Multi-item bills.** A walk-in customer buys a filter, a bulb and a clutch cable and pays once, so
`/sales/new` is a bill builder: tap a part to add it, tap again for a second one, adjust quantity and
price per line. One tap on **Pay through Razorpay** creates one charge for the whole bill and shows
the QR.

Under the hood a bill is the payment envelope; each line is still its own `transactions` row carrying
its own part, quantity and amount. So the dashboard keeps reading one table and nothing else, and
per-part figures still work — 66 seeded bills for the demo shop are 119 line items.

**Two ways to pay, and the difference decides when stock moves.**

*Razorpay* — the customer scans. Capture and handover are separate moments: the parts are still on
the shelf while the QR is on screen, so capture only marks the bill paid. The bill then offers
exactly the two things that happen next at a counter:

- **Cut stock for these items** — the parts have left the shelf. Idempotent, so a double tap cannot
  double-deduct, and it refuses to run before the bill is paid.
- **New bill** — next customer.

Until stock is cut, the bill shows an amber "money in, parts still on the shelf" callout and the
counter board flags it. That gap is real: a paid bill whose goods are still on the shelf is a state
worth modelling, and collapsing it into the payment is how a ledger and a shelf drift apart.

*Cash* — the money is already in the till and the parts are already in the customer's hand. There is
no gap to model, so **Cash received** writes the bill and cuts stock in one action. Both paths run
through the same `deduct_bill_stock()` function, so the idempotency and the refuse-if-unpaid guard
apply either way. If the deduction somehow fails the bill still stands as paid, and the button is
there to finish the job.

**There is still no "just write it in the ledger" button.** Every row is anchored to something that
actually happened — a Razorpay capture, or cash taken and stock moved in the same breath.

**The dashboard** reads `transactions` and nothing else, and carries a dedicated **Walk-in counter**
board: taken today, taken this month, the Razorpay/cash split, anything needing attention, and the
last few bills with their state and payment method.

### The platform fee is zero

`PLATFORM_FEE_BPS` defaults to **0**, so PartLoop takes nothing from either kind of sale.

It was 2% on shop-to-shop trades. The arithmetic killed it: Razorpay already takes roughly 2.6% of
every payment in processing fees, so a 2% rake meant the selling shop lost about **4.6%** on a
wholesale margin that is typically 10-15%. That is a third of the margin, charged to the shop doing
the favour — taxing precisely the behaviour the network needs, which is shops listing stock they are
sitting on.

The intended model is a **flat per-shop subscription**. It does not scale with transaction size, so
a big trade is not punished, and listing stock never feels expensive.

The mechanism is still there and still tested: set `PLATFORM_FEE_BPS=200` and 2% comes back with no
code change. Fees are frozen onto the transaction row at reservation time, so changing the rate
never rewrites what past trades were agreed at.

### Money

Everything is integer paise, end to end — database columns, arithmetic, and the Razorpay API. Rupees
exist only at the formatting boundary (`src/lib/format.ts`). No floats touch money.

### Idempotency

Three paths can fulfil a payment: the webhook, the reconcile poll, and the simulator. They all call
one function, `fulfilPayment()` in `src/lib/data/fulfilment.ts`, which gates on the current status
before touching anything. A webhook that fires twice, or a webhook that races the poll, cannot
decrement stock twice. The webhook returns 500 on a genuine failure so Razorpay retries — safe,
because retries are idempotent.

---

## Authentication

**This build ships a shop picker, not phone OTP.** Choosing a shop sets an httpOnly cookie holding
that shop's uuid; every server route resolves the acting shop from it. There is no password. This is
stated on the login screen itself rather than dressed up as authentication — the hackathon time went
into the Razorpay flows instead.

**What this means for RLS.** With no Supabase Auth JWT there is no `auth.uid()` for policies to key
off, so all database access happens in Next.js server code using the `service_role` key, and shop
scoping is enforced in the server layer (`src/lib/auth/session.ts`). The anon key is never shipped to
the browser.

RLS is still enabled on all four tables, as defence in depth and as a real migration path:

- `supabase/migrations/0003_rls.sql` defines policies against `public.current_shop_id()`, which reads
  a `shop_id` claim from the JWT. Under the demo picker there is no JWT, so it returns null and every
  policy evaluates false — deny by default. Swap the picker for Supabase Auth with that custom claim
  and the policies go live with no other change.
- `supabase/migrations/0006_grants.sql` **revokes Supabase's default broad grants** on these tables
  and re-grants exactly what the policies are written for. Supabase hands `anon` and `authenticated`
  privileges on everything in `public` by default, leaving RLS as the only thing between an anonymous
  request and the data; that is one missing policy away from a leak. Notably `authenticated` gets no
  `UPDATE` on `transactions` at all — a client cannot mark its own purchase paid.

Both are exercised for real by `npm run db:verify`, not just eyeballed.

---

## Verifying it

```bash
npm run verify
```

Runs, in order:

- `npm run typecheck` — `tsc --noEmit`, strict mode, no `any`
- `npm run lint` — ESLint
- `npm run test` — 21 unit tests over the webhook signature check, platform-fee arithmetic,
  simulated/mock detection, and money/date formatting
- `npm run db:verify` — **80 assertions against a real Postgres.** Spins up an ephemeral in-process
  database (PGlite), creates Supabase's `anon` / `authenticated` / `service_role` roles, applies every
  migration and the seed, then checks that fuzzy search actually resolves the misspellings and
  Hindi-English aliases the demo depends on, that Haversine distances are sane, that the demo
  carve-outs held, that the ledger constraints reject malformed rows, that the RLS policies leak
  nothing, that paying a Razorpay bill does *not* move stock while cutting it twice does not
  double-deduct, that a cash bill never carries a Razorpay id, and that the PostgREST foreign-key
  hints in `src/lib/data/*.ts` match real constraint names.

That last suite caught four real bugs during the build: a non-`IMMUTABLE` index expression that would
have failed on Supabase, `current_shop_id()` throwing on the empty `request.jwt.claims` PostgREST
sends for anonymous requests (which fails the whole query instead of denying the row), missing table
grants, and a search threshold loose enough to return 25 unrelated parts for `i20 brake pad`.

---

## Layout

```
supabase/
  config.toml          local stack, trimmed to the services this app uses
  migrations/          0001 schema · 0002 indexes · 0003 RLS · 0004 search · 0005 stock ops
                       0006 grants · 0007 counter bills · 0008 cash bills
    down/              matching rollbacks, kept out of the CLI's apply path
  seed.sql             6 Pune shops, 42 parts with messy aliases, patchy stock,
                       a month of multi-item counter bills, ~55% of them cash
scripts/
  db.mjs               push / seed / reset against SUPABASE_DB_URL
  local-env.mjs        writes .env.local from a running `supabase start`
  verify-db.mjs        the PGlite assertion suite
    checks/bills.mjs   counter-bill assertions
src/
  app/
    login/             demo shop picker
    (app)/             dashboard · search · inventory · sales/new (bill builder) · bills/[id]
                       transactions/[id] · simulate/pay/[id]
    api/               search · reservations(/[id]/pay,/release) · bills(/[id]/deduct-stock,/reconcile)
                       inventory · catalog · transactions/[id]/reconcile · razorpay/webhook
                       simulate/[id]/pay · simulate/bill/[id]/pay
  lib/
    auth/session.ts    the shop cookie and the guards
    data/              search (+ masking) · transactions (reserve/pay) · bills (counter sales)
                       fulfilment (settle) · dashboard · inventory
    razorpay/client.ts typed REST wrapper + simulated mode
  components/          search (incl. Leaflet map) · dashboard (incl. Recharts + counter board)
                       inventory · sales (bill builder) · bills · transactions
```

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind v4 · shadcn/ui · Supabase (Postgres + RLS) ·
Razorpay REST (Orders, Payment Links, Route, Settlement Hold) · Leaflet + OpenStreetMap · Recharts.

`pg_trgm` for fuzzy matching and plain Haversine trigonometry for distance — no PostGIS, no
`earthdistance`, no embeddings. For 42 parts and six shops in one city, anything more would be
decoration.

## Scope

Auto parts only, one city (Pune), text search only. No AI voice/photo search, no WhatsApp ingestion,
no multi-city, no multi-category — deliberately out of scope for this build.
