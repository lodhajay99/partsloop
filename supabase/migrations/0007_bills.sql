-- PartLoop 0007: counter bills (multi-item walk-in sales)
--
-- A walk-in customer buys three things at once and pays once. That is one
-- Razorpay charge over several parts, so a bill is the payment envelope and the
-- `transactions` rows under it are the line items.
--
-- Deliberately NOT a second ledger: money still lives in `transactions`, one row
-- per line, each carrying its own part, quantity and amount. The dashboard keeps
-- reading `transactions` and nothing else. `bills` only holds what belongs to
-- the envelope — the total, the Razorpay ids, and whether stock has been taken
-- off the shelf yet.

create table if not exists bills (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  -- Per-shop counter, the way a paper bill book runs. Unique with shop_id so a
  -- race produces a constraint violation to retry, never two bills numbered 41.
  bill_number int not null,
  total_paise int not null check (total_paise >= 0),
  status text not null default 'created'
    check (status in ('created', 'paid', 'stocked', 'cancelled')),
  razorpay_order_id text,
  razorpay_payment_link_id text,
  razorpay_payment_link_url text,
  razorpay_payment_id text,
  simulated boolean not null default false,
  is_seed boolean not null default false,     -- backdated demo history, never charged
  paid_at timestamptz,
  -- Null until the shopkeeper confirms the parts actually left the counter.
  -- Payment and handover are separate events; conflating them is how a ledger
  -- ends up disagreeing with the shelf.
  stock_deducted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (shop_id, bill_number)
);

alter table transactions
  add column if not exists bill_id uuid references bills(id) on delete cascade;

create index if not exists transactions_bill_idx on transactions (bill_id);
create index if not exists bills_shop_created_idx on bills (shop_id, created_at desc);
create index if not exists bills_payment_link_idx on bills (razorpay_payment_link_id);
create index if not exists bills_order_idx on bills (razorpay_order_id);

-- ---------------------------------------------------------------------------
-- RLS (same posture as 0003: deny by default, policies keyed on the JWT claim
-- that goes live when the demo picker is swapped for Supabase Auth)
-- ---------------------------------------------------------------------------
alter table bills enable row level security;

drop policy if exists bills_read_own on bills;
create policy bills_read_own on bills
  for select to authenticated using (shop_id = current_shop_id());

drop policy if exists bills_write_own on bills;
create policy bills_write_own on bills
  for all to authenticated
  using (shop_id = current_shop_id())
  with check (shop_id = current_shop_id());

revoke all on table bills from anon, authenticated;
grant select, insert, update on table bills to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.next_bill_number(p_shop_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce(max(b.bill_number), 0) + 1 from bills b where b.shop_id = p_shop_id;
$$;

-- Takes the bill's parts off the shelf, exactly once.
--
-- Runs as a single statement per concern under a row lock on the bill, so two
-- taps on "Deduct stock" cannot double-decrement. Returns already_done = true
-- on the second call rather than raising, because the second tap is a
-- double-click, not an error.
create or replace function public.deduct_bill_stock(p_bill_id uuid, p_shop_id uuid)
returns table (lines_deducted int, already_done boolean)
language plpgsql
volatile
set search_path = public
as $$
declare
  v_deducted timestamptz;
  v_status text;
  v_count int := 0;
begin
  select b.stock_deducted_at, b.status
    into v_deducted, v_status
    from bills b
   where b.id = p_bill_id and b.shop_id = p_shop_id
     for update;

  if not found then
    raise exception 'Bill not found for this shop.';
  end if;

  if v_deducted is not null then
    return query select 0, true;
    return;
  end if;

  if v_status not in ('paid', 'stocked') then
    raise exception 'Stock comes off the shelf only after the bill is paid (status is %).', v_status;
  end if;

  -- Group by part first: the same part can appear on two lines of one bill.
  with lines as (
    select t.part_id, sum(t.quantity)::int as qty
      from transactions t
     where t.bill_id = p_bill_id
     group by t.part_id
  )
  update inventory i
     set quantity = greatest(i.quantity - l.qty, 0),
         last_verified_at = now()
    from lines l
   where i.shop_id = p_shop_id and i.part_id = l.part_id;

  get diagnostics v_count = row_count;

  update bills
     set stock_deducted_at = now(), status = 'stocked'
   where id = p_bill_id;

  update transactions
     set status = 'completed'
   where bill_id = p_bill_id;

  return query select v_count, false;
end;
$$;

revoke all on function public.deduct_bill_stock(uuid, uuid) from public;
grant execute on function public.next_bill_number(uuid) to authenticated;
