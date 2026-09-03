-- PartLoop 0009: cancelling a counter bill
--
-- Three genuinely different situations hide behind one "cancel" button, and
-- they must not be collapsed:
--
--   created  — nobody paid. Nothing to undo but the bill itself. A clean void.
--   paid     — money arrived. Voiding the ledger without returning the money
--              would make the books lie, so the caller refunds first (cash back
--              across the counter, or the Razorpay Refunds API) and only then
--              calls this.
--   stocked  — money arrived AND parts left the shelf. Both must be reversed.
--
-- The ledger keeps the rows either way. A cancelled bill is a fact about the
-- day's trading, and deleting it would leave a hole in the bill numbering that
-- nobody could explain later.

alter table bills add column if not exists cancelled_at timestamptz;
alter table bills add column if not exists cancel_reason text;
-- Razorpay refund id when a paid Razorpay bill was reversed; null for cash
-- refunds and for bills that were never paid.
alter table bills add column if not exists razorpay_refund_id text;

-- Line items need a terminal state that is neither revenue nor an expiry.
-- 'cancelled' = the sale never happened; 'refunded' = it happened and was undone.
alter table transactions drop constraint if exists transactions_status_check;
alter table transactions add constraint transactions_status_check check (
  status in (
    'created', 'reserved', 'paid', 'on_hold', 'released',
    'completed', 'expired', 'refunded', 'cancelled'
  )
);

create index if not exists bills_shop_status_idx on bills (shop_id, status);

-- Reverses a bill exactly once, under a row lock so a double-tap cannot
-- restore stock twice.
--
-- Returns already_cancelled = true on a repeat call rather than raising: the
-- second press is a double-click, not an error.
create or replace function public.cancel_bill(
  p_bill_id uuid,
  p_shop_id uuid,
  p_reason text default null
)
returns table (restored_lines int, previous_status text, already_cancelled boolean)
language plpgsql
volatile
set search_path = public
as $$
declare
  v_status text;
  v_deducted timestamptz;
  v_restored int := 0;
begin
  select b.status, b.stock_deducted_at
    into v_status, v_deducted
    from bills b
   where b.id = p_bill_id and b.shop_id = p_shop_id
     for update;

  if not found then
    raise exception 'Bill not found for this shop.';
  end if;

  if v_status = 'cancelled' then
    return query select 0, v_status, true;
    return;
  end if;

  -- Put the parts back on the shelf if they were ever taken off.
  if v_deducted is not null then
    with lines as (
      select t.part_id, sum(t.quantity)::int as qty
        from transactions t
       where t.bill_id = p_bill_id
       group by t.part_id
    )
    update inventory i
       set quantity = i.quantity + l.qty,
           last_verified_at = now()
      from lines l
     where i.shop_id = p_shop_id and i.part_id = l.part_id;

    get diagnostics v_restored = row_count;
  end if;

  update bills
     set status = 'cancelled',
         cancelled_at = now(),
         cancel_reason = p_reason,
         stock_deducted_at = null
   where id = p_bill_id;

  -- A bill that was never paid was never a sale; one that was paid became a
  -- sale and is now being reversed. The ledger should be able to tell those
  -- apart when someone reads the month back.
  update transactions
     set status = case when v_status = 'created' then 'cancelled' else 'refunded' end
   where bill_id = p_bill_id;

  return query select v_restored, v_status, false;
end;
$$;

revoke all on function public.cancel_bill(uuid, uuid, text) from public;
