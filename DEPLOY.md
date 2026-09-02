# Deploying PartLoop to Vercel

Start to finish, about 15 minutes. Nothing here needs the Vercel CLI.

The Supabase project is already created and seeded — this is only about getting the
app onto a public URL and pointing Razorpay at it.

---

## 1. Get the code onto GitHub

Vercel deploys from a git repo. From the unzipped folder:

```bash
git init
git add .
git commit -m "PartLoop"
```

Create an empty repo on GitHub (no README, no .gitignore — the project has both), then:

```bash
git remote add origin https://github.com/<you>/partloop.git
git branch -M main
git push -u origin main
```

**Check before pushing:** `git status` must not list `.env.local`. It is in `.gitignore`,
so it should not appear — if it does, stop and fix that first. It holds the Supabase
service-role key and the Razorpay secret, and pushing it to a public repo leaks both.

```bash
git ls-files | grep -c "^\.env\.local$"    # must print 0
```

---

## 2. Import into Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → pick the repo.
2. Framework preset: **Next.js** (auto-detected). Leave build command, output directory
   and install command alone — the defaults are right.
3. Before clicking Deploy, open **Environment Variables** and add the four below.

### Environment variables

| Name | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` key | **Secret.** Server-only — the name has no `NEXT_PUBLIC_` prefix on purpose, so it is never sent to the browser. |
| `RAZORPAY_KEY_ID` | `rzp_test_…` | Razorpay → Account & Settings → API Keys, Test Mode |
| `RAZORPAY_KEY_SECRET` | the test secret | **Secret.** |

Apply each to **Production, Preview and Development**.

**Do not set `NEXT_PUBLIC_APP_URL`.** The app reads Vercel's own `VERCEL_URL` /
`VERCEL_PROJECT_PRODUCTION_URL` when it is absent, so Razorpay callbacks point at the
right host automatically — including on preview deployments. Setting it to a stale value
is the most common way to end up with payment links that redirect customers to
`localhost:3000`. Only set it once a custom domain is attached.

Optional, all with sensible defaults: `PLATFORM_FEE_BPS` (200 = 2%),
`RESERVATION_HOLD_MINUTES` (30), `NEXT_PUBLIC_LOW_STOCK_THRESHOLD` (3).

4. **Deploy.** First build takes a couple of minutes.

---

## 3. Check it came up

Open the deployment URL. You should see the shop picker with six Pune shops.

- Header shows a green **Razorpay test mode** chip → the keys are live.
  An amber **Simulated** chip means `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` did not
  reach the deployment.
- Pick **Shree Auto Spares** → the dashboard should show a full month of takings.
- **New bill** → tap two parts → **Pay through Razorpay** → a real QR appears.
  Pay it with test card `4111 1111 1111 1111`, any future expiry, any CVV.

### If you see "PartLoop needs a database"

The deploy worked — the app just has no Supabase credentials yet. **There is no
`.env.local` on Vercel**; that file is local-only and must never be committed. Add
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` under Settings → Environment
Variables, then **redeploy** — env vars are read at build and boot, so an existing
deployment will not pick them up.

If the shop picker instead says *"Could not load shops"*, the credentials arrived but the
schema has not been loaded — run `npm run db:bundle` and paste `supabase/bundle.sql` into
the Supabase SQL editor.

---

## 4. Wire the webhook (optional, but do it now that there is a public URL)

On localhost a webhook cannot reach you, which is why the app also reconciles by polling
Razorpay. In production the webhook is the better path.

1. Razorpay dashboard → **Settings → Webhooks → Add New Webhook**.
2. URL: `https://<your-deployment>.vercel.app/api/razorpay/webhook`
3. Active events: **`payment.captured`** and **`payment_link.paid`**.
4. Set a secret, then add it to Vercel as `RAZORPAY_WEBHOOK_SECRET` and **redeploy**
   (env var changes only take effect on a new deployment).

If the same Razorpay account already has a webhook for another project, **add a second
endpoint** — do not edit the existing one, that would break the other project. Each app
will then also receive the other's events; PartLoop answers
`{ok: true, ignored: "no matching transaction"}` for anything it does not recognise and
never touches the ledger.

Without the secret set, the endpoint rejects every call with `400 Invalid webhook
signature` — which is correct behaviour, not a bug. The in-app **"check Razorpay"** button
keeps working either way.

---

## 5. Before you submit

- [ ] Green **Razorpay test mode** chip on the deployed site
- [ ] Dashboard shows a populated month
- [ ] One live bill paid end to end, visible in the Razorpay test dashboard
- [ ] `.env.local` is **not** in the GitHub repo
- [ ] README's "What is real and what is not" table read once — it is the honest
      summary of which Razorpay calls are real and which are stand-ins

### Known behaviour worth explaining if asked

**Route splits stay simulated.** The six demo shops carry `acc_MOCK…` Linked Account ids.
Real Razorpay Route onboarding needs KYC that cannot be done for a hackathon, so the
shop-to-shop split and settlement hold run their arithmetic and label themselves
*"Simulated Route split"* with the reason on screen. Everything else — Orders, Payment
Links, capture, reconcile — is a real API call. Swapping in real `acc_…` ids makes the
same code path live with no changes.

**The dashboard opens on the most recent month with data.** A month-to-date view is
legitimately near-empty on the 1st, so it defaults to the last month that has trading in
it and marks it *"closed month"*; the ‹ › arrows move between months and **Latest** jumps
back. Seed data covers the current month up to today, so a project seeded in one month and
demoed in the next will open on the earlier month — that is the feature working, not stale
data.

---

## Re-seeding a fresh Supabase project

If you point at a different Supabase project later:

```bash
npm run db:bundle     # writes supabase/bundle.sql
```

Paste that one file into the Supabase **SQL Editor** and run it. No database password
needed. (`npm run db:push && npm run db:seed` also works if you have the Postgres
connection string — the **Session pooler** URI, not the REST URL.)
