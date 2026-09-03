-- PartLoop 0010: pass Razorpay's processing fee to whoever is paying
--
-- Razorpay deducts roughly 2.2% plus 18% GST on that fee — about 2.6% — from
-- every payment before settling it. Until now the seller silently absorbed it:
-- list a part at ₹2,232 and ₹58 quietly disappears. This adds the fee to what
-- the payer is charged instead, so the seller banks the price they listed.
--
-- IMPORTANT — this is stored, not derived. Razorpay's published rate can change
-- and varies by payment method, so recomputing an old bill's surcharge from
-- today's rate would silently restate what a customer was actually charged.
-- The figure is frozen onto the row when the charge is created, like
-- platform_fee_paise.
--
-- Cash bills carry 0 here by construction: there is no processor to reimburse.

alter table bills
  add column if not exists processing_fee_paise int not null default 0
    check (processing_fee_paise >= 0);

alter table transactions
  add column if not exists processing_fee_paise int not null default 0
    check (processing_fee_paise >= 0);

-- Cash never has a processing fee — nothing sits between the till and the shop.
alter table bills drop constraint if exists cash_bills_have_no_processing_fee;
alter table bills add constraint cash_bills_have_no_processing_fee check (
  payment_method <> 'cash' or processing_fee_paise = 0
);

comment on column bills.total_paise is
  'Goods subtotal — what the parts cost. The customer is charged '
  'total_paise + processing_fee_paise; the shop earns total_paise.';

comment on column bills.processing_fee_paise is
  'Razorpay processing fee passed on to the payer. Frozen at charge time.';

comment on column transactions.processing_fee_paise is
  'Razorpay processing fee added on top of amount_paise for the buyer. '
  'Never counted as the seller''s revenue.';
