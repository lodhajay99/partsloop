# PartLoop — demo video script

Target: **2 min 45 s**. Voiceover is ~420 words, which lands around 150 wpm — an
unhurried pace. Record screen at 1440×900 or larger so the ledger table is legible.

---

## Before you record

- [ ] App open and signed in as **Shree Auto Spares**
- [ ] **Razorpay test dashboard** open in a second tab, on **Payment Links** — this is the
      proof shot, and fumbling for it on camera kills the pace
- [ ] Header shows the green **Razorpay test mode** chip (amber "Simulated" = keys missing)
- [ ] Dashboard opens on a month with data. It defaults to the latest month that has
      trading, so it may say **August 2026 · closed month** — that is correct, don't fight it
- [ ] Test card ready: `4111 1111 1111 1111`, any future expiry, any CVV
- [ ] Confirm Shree Auto Spares still has **no** "Hyundai i20 2018 Front Brake Pad Set" —
      the whole search beat depends on that gap being real
- [ ] Close other tabs. Notifications off.

> If the keys were rotated after the leak, update `.env.local` (or the Vercel env vars)
> and reload before recording, or the payment steps will fail on camera.

---

## The script

| Time | On screen | Say this |
| --- | --- | --- |
| **0:00–0:18** | Dashboard, Shree Auto Spares. Slowly scroll the stat row → Walk-in counter board. | "This is a parts shop's month. Four lakh eighty-seven thousand in, a hundred and forty-three payments, split between the counter and other shops. Every number here comes from one table — because every sale went through Razorpay, the books *are* the payment records. There's no second ledger to keep in sync." |
| **0:18–0:30** | Point at the Walk-in counter board: Razorpay / cash figures. | "And it's honest about what it is. Two lakh scanned through Razorpay, three lakh in cash. Cash has no payment record behind it, so it's tagged and counted separately rather than quietly folded in." |
| **0:30–1:00** | **New bill.** Tap three parts — tap one of them twice. Adjust a price. | "A customer buys three things. One bill, not three sales — tap to add, tap again for a second unit, prices stay editable because haggling at a counter is normal." |
| **1:00–1:20** | **Pay through Razorpay** → QR appears. Cut to the Razorpay tab, refresh, show the new Payment Link. | "One Razorpay charge for the whole bill. That link is real — here it is in the Razorpay dashboard, same amount, same second." |
| **1:20–1:40** | Pay it with the test card. Return; bill flips to *Paid · stock still on shelf*. Point at the amber callout. | "Paid. But notice what *hasn't* happened — the stock hasn't moved. The money's in and the parts are still on the shelf, and that's a real state. Collapsing it into the payment is how a ledger and a shelf drift apart." |
| **1:40–1:52** | **Cut stock for these items.** Show quantities dropping. | "The parts leave the counter, and now the stock comes off. One tap, and it can't double-deduct." |
| **1:52–2:05** | **Find a part** → type `i20 brek pad`, misspelled. Results appear. | "Now the part he doesn't have. Typed the way a shop owner actually types — misspelled. Five shops nearby have it: distance, price, and how recently each one confirmed the stock." |
| **2:05–2:18** | Point at the map — dashed circles, "Shop A…E", the hidden badges. | "But not *who*. These are competitors. Names and exact locations are hidden until you commit — and they're stripped on the server, so there's nothing in the page to un-hide." |
| **2:18–2:35** | **Reserve** → seller revealed. Then **Pay now** → show the split panel. | "Reserve, and the seller appears — Balaji Motor Parts, address, phone, held thirty minutes. Paying splits the money with Razorpay Route: most to the seller, two percent to the platform — and the seller's share is held, not settled." |
| **2:35–2:45** | **Mark received** → status goes to Released. | "He picks the part up, marks it received, and the hold releases. Escrow-*like*, built on Route's settlement controls." |
| **2:45–end** | Switch shop → Balaji's dashboard → their ledger shows the sale. | "And on the other side, that sale is already in Balaji's month. One Razorpay-powered ledger — whether you sold to a customer at your counter, or to the shop down the road." |

---

## If you only have 90 seconds

Cut the cash board (0:18–0:30) and the counter-bill build (0:30–1:00). Open on the
dashboard for 10 seconds, then go straight to the misspelled search → reserve → pay →
release → the seller's ledger. That's the differentiated half; the sales log is table
stakes by comparison.

---

## Say this if a judge asks — and say it before they find it

**"Route splits are simulated."** The six demo shops carry `acc_MOCK…` Linked Account
ids because real Route onboarding needs KYC we couldn't do in a hackathon. The split
arithmetic, the hold and the release all run and are labelled on screen. Everything else
— Orders, Payment Links, capture, and reconciling against Razorpay — is a real API call.
Swap in real `acc_…` ids and the same code path goes live unchanged.

**Don't say "escrow."** The app never does. It's an escrow-*like* pattern on Route's
settlement controls; real escrow needs bank-partner approval.

**The `seed` badges** are backdated demo history that never touched Razorpay. Anything you
create on camera is real. Both are labelled in the UI — pointing that out yourself reads
as judgment, not as a gap.
