-- PartLoop 0011: let either side call off an unpaid reservation
--
-- A reservation was one-directional: the buyer reserved, and the selling shop
-- had no say at all. Its only exit was the 30-minute hold lapsing. But a seller
-- has entirely legitimate reasons to decline — the part is already promised to
-- a walk-in customer, the listed price was stale, the last one turned out to be
-- damaged — and making them wait out a timer while a buyer drives over is worse
-- for both sides than saying no immediately.
--
-- Scope is deliberately unpaid reservations only. Once money is captured the
-- seller's share is sitting under a Razorpay settlement hold, and unwinding
-- that is a refund plus a hold release, not a cancellation.
--
-- No stock to restore: stock moves on payment capture (consume_stock), so an
-- unpaid reservation was never holding any.

alter table transactions add column if not exists cancelled_at timestamptz;
alter table transactions add column if not exists cancel_reason text;

-- Which side called it off. The buyer seeing "the seller declined" rather than
-- a silent disappearance is the difference between a marketplace people trust
-- and one they stop listing stock on.
alter table transactions
  add column if not exists cancelled_by_shop_id uuid references shops(id) on delete set null;

create index if not exists transactions_cancelled_idx
  on transactions (cancelled_by_shop_id) where cancelled_by_shop_id is not null;

-- Calls off an unpaid reservation, from either side, exactly once.
--
-- Takes a row lock so two people pressing at the same moment cannot both
-- "cancel" it, and refuses anything already paid rather than quietly leaving a
-- captured payment attached to a cancelled row.
create or replace function public.cancel_reservation(
  p_transaction_id uuid,
  p_acting_shop_id uuid,
  p_reason text default null
)
returns table (previous_status text, cancelled_by_seller boolean, already_cancelled boolean)
language plpgsql
volatile
set search_path = public
as $$
declare
  v_status text;
  v_type text;
  v_seller uuid;
  v_buyer uuid;
begin
  select t.status, t.type, t.seller_shop_id, t.buyer_shop_id
    into v_status, v_type, v_seller, v_buyer
    from transactions t
   where t.id = p_transaction_id
     for update;

  if not found then
    raise exception 'Reservation not found.';
  end if;

  if v_type <> 'inter_shop_purchase' then
    raise exception 'Only a shop-to-shop reservation can be called off this way.';
  end if;

  if p_acting_shop_id <> v_seller and p_acting_shop_id <> v_buyer then
    raise exception 'Only the buying or selling shop can call this off.';
  end if;

  if v_status = 'cancelled' then
    return query select v_status, p_acting_shop_id = v_seller, true;
    return;
  end if;

  if v_status not in ('reserved', 'created') then
    raise exception
      'This reservation is already %, so it cannot simply be called off.', v_status;
  end if;

  update transactions
     set status = 'cancelled',
         cancelled_at = now(),
         cancel_reason = p_reason,
         cancelled_by_shop_id = p_acting_shop_id,
         hold_until = null
   where id = p_transaction_id;

  return query select v_status, p_acting_shop_id = v_seller, false;
end;
$$;

revoke all on function public.cancel_reservation(uuid, uuid, text) from public;
