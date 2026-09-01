-- PartLoop 0008: cash at the counter
--
-- Razorpay stays the default, but a shop takes cash all day and those sales are
-- just as real: the parts leave the shelf and the money is in the till. Refusing
-- to bill them would mean the stock count drifts and the shopkeeper keeps a
-- second, paper record — exactly what this app exists to eliminate.
--
-- The trade-off is stated rather than hidden. A cash bill has no Razorpay
-- payment record behind it, so it is tagged here and badged `cash` everywhere it
-- is shown, and the dashboard splits counter takings by method. The claim the
-- product makes stays precise: everything charged through Razorpay reconciles to
-- a Razorpay record, and anything that did not says so.

alter table bills
  add column if not exists payment_method text not null default 'razorpay'
    check (payment_method in ('razorpay', 'cash'));

-- Mirrored onto the line items so the ledger table can badge a row without
-- joining back to the bill, the same way razorpay_payment_id already is.
-- Inter-shop purchases are always 'razorpay': they settle through Route.
alter table transactions
  add column if not exists payment_method text not null default 'razorpay'
    check (payment_method in ('razorpay', 'cash'));

create index if not exists bills_shop_method_idx on bills (shop_id, payment_method);

-- A cash bill is paid the moment it is written; it can never sit unpaid waiting
-- for a customer to scan.
alter table bills drop constraint if exists cash_bills_are_paid;
alter table bills add constraint cash_bills_are_paid check (
  payment_method <> 'cash' or status in ('paid', 'stocked', 'cancelled')
);
