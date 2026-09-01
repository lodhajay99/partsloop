drop function if exists public.deduct_bill_stock(uuid, uuid);
drop function if exists public.next_bill_number(uuid);
drop policy if exists bills_write_own on bills;
drop policy if exists bills_read_own on bills;
drop index if exists transactions_bill_idx;
alter table transactions drop column if exists bill_id;
drop table if exists bills;
