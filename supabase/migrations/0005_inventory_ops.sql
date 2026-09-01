-- PartLoop 0005: atomic inventory mutation used on payment capture.
--
-- Stock is decremented in a single UPDATE so two concurrent captures cannot
-- read the same quantity and both write it back. Touching last_verified_at on
-- every sale is deliberate: a shop that is actively selling a part is, by
-- definition, confirming it has that part — which is what the freshness badge
-- on search results is claiming.

create or replace function public.consume_stock(
  p_shop_id uuid,
  p_part_id uuid,
  p_qty int
)
returns int
language plpgsql
volatile
set search_path = public
as $$
declare
  remaining int;
begin
  update inventory
     set quantity = greatest(quantity - p_qty, 0),
         last_verified_at = now()
   where shop_id = p_shop_id
     and part_id = p_part_id
  returning quantity into remaining;

  -- No inventory row (e.g. the seller never listed it) is not an error: the
  -- ledger entry still stands, there is simply no stock line to decrement.
  return coalesce(remaining, -1);
end;
$$;
