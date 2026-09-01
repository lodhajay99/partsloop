-- PartLoop 0006: table and function privileges
--
-- Supabase grants anon and authenticated broad privileges on every table in
-- `public` by default, leaving RLS as the only thing standing between an
-- anonymous request and the data. That is one missing policy away from a leak,
-- so this migration revokes those defaults and re-grants exactly what the
-- policies in 0003 are written for — privileges and policies agreeing with each
-- other, rather than one silently covering for the other.
--
-- service_role is untouched: it bypasses RLS by design and is what the Next.js
-- server layer uses.

grant usage on schema public to anon, authenticated;

revoke all on table shops, parts, inventory, transactions from anon, authenticated;

-- Public catalog.
grant select on table parts to anon, authenticated;

-- A signed-in shop reads every shop (search results, map) and edits only its own.
grant select, update on table shops to authenticated;

-- Cross-shop stock visibility is the product; writes are policy-scoped to the owner.
grant select, insert, update, delete on table inventory to authenticated;

-- Shops read and open their own transactions. Payment-state transitions
-- (paid / on_hold / released) are written by the webhook as service_role, so
-- authenticated deliberately gets no UPDATE here — a client cannot mark its own
-- purchase paid.
grant select, insert on table transactions to authenticated;

-- Postgres grants EXECUTE on new functions to PUBLIC. Close that, then hand back
-- only the read-side helpers.
revoke all on function public.consume_stock(uuid, uuid, int) from public;
revoke all on function public.expire_stale_reservations() from public;

grant execute on function public.current_shop_id() to anon, authenticated;
grant execute on function public.aliases_text(text[]) to anon, authenticated;
grant execute on function public.distance_km(
  double precision, double precision, double precision, double precision
) to anon, authenticated;
grant execute on function public.search_parts(text, int) to authenticated;
grant execute on function public.search_available_parts(text, uuid, double precision, int) to authenticated;
