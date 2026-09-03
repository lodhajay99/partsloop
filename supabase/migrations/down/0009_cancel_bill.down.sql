drop function if exists public.cancel_bill(uuid, uuid, text);
drop index if exists bills_shop_status_idx;

alter table transactions drop constraint if exists transactions_status_check;
alter table transactions add constraint transactions_status_check check (
  status in (
    'created', 'reserved', 'paid', 'on_hold', 'released',
    'completed', 'expired', 'refunded'
  )
);

alter table bills drop column if exists razorpay_refund_id;
alter table bills drop column if exists cancel_reason;
alter table bills drop column if exists cancelled_at;
