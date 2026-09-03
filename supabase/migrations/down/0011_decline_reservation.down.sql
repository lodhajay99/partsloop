drop function if exists public.cancel_reservation(uuid, uuid, text);
drop index if exists transactions_cancelled_idx;
alter table transactions drop column if exists cancelled_by_shop_id;
alter table transactions drop column if exists cancel_reason;
alter table transactions drop column if exists cancelled_at;
