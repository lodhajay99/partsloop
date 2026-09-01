-- PartLoop 0002: indexes for trigram search, nearby lookups and the dashboard

create index if not exists parts_canonical_name_trgm_idx
  on parts using gin (canonical_name gin_trgm_ops);

-- aliases is text[], which trigram indexes cannot read directly, and
-- array_to_string() is only STABLE (its behaviour depends on the element type's
-- output function) so Postgres refuses it in an index expression. This wrapper
-- pins it to text[] -> text, which genuinely is immutable, and gives the index
-- something to key on. The search functions in 0004 call this same wrapper for
-- their substring match so the index is actually used.
create or replace function public.aliases_text(aliases text[])
returns text
language sql
immutable
parallel safe
as $$
  select array_to_string(aliases, ' ');
$$;

create index if not exists parts_aliases_trgm_idx
  on parts using gin (public.aliases_text(aliases) gin_trgm_ops);

create index if not exists inventory_part_idx on inventory (part_id) where quantity > 0;
create index if not exists inventory_shop_idx on inventory (shop_id);

create index if not exists transactions_seller_created_idx
  on transactions (seller_shop_id, created_at desc);
create index if not exists transactions_buyer_created_idx
  on transactions (buyer_shop_id, created_at desc);
create index if not exists transactions_order_idx on transactions (razorpay_order_id);
create index if not exists transactions_payment_link_idx on transactions (razorpay_payment_link_id);
create index if not exists transactions_status_hold_idx on transactions (status, hold_until);
