-- PartLoop 0003: Row Level Security
--
-- HOW THIS APP AUTHENTICATES (read before changing):
-- The demo build uses a server-side shop picker (httpOnly cookie), not Supabase
-- Auth, so there is no auth.uid()/JWT in the demo. Every database read and write
-- happens in Next.js server code using the service_role key, which bypasses RLS,
-- and shop scoping is enforced in the server layer (src/lib/auth/session.ts).
-- The anon key is never shipped to the browser.
--
-- So RLS here is defence-in-depth: everything is denied by default, and the
-- policies below are the ones that become live the moment you swap the picker
-- for Supabase Auth with a `shop_id` custom claim. They are written against
-- public.current_shop_id() so that swap is a one-function change.

-- Resolves the caller's shop from a `shop_id` claim on the Supabase JWT.
-- Returns null under the demo picker (no JWT) -> every policy below evaluates
-- false -> anon/authenticated get nothing. That is the intended demo posture.
--
-- Every failure mode returns null rather than raising. PostgREST sets
-- request.jwt.claims to an empty string for anonymous requests, and a bare
-- ''::jsonb cast throws 22P02 — which inside an RLS policy fails the whole
-- query instead of denying the row. Malformed claims and a non-uuid shop_id
-- are swallowed for the same reason: an unreadable identity is no identity.
create or replace function public.current_shop_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  raw text := nullif(current_setting('request.jwt.claims', true), '');
  claims jsonb;
  value text;
begin
  if raw is null then
    return null;
  end if;

  begin
    claims := raw::jsonb;
  exception when others then
    return null;
  end;

  value := coalesce(claims ->> 'shop_id', claims -> 'app_metadata' ->> 'shop_id');
  if value is null or value = '' then
    return null;
  end if;

  begin
    return value::uuid;
  exception when others then
    return null;
  end;
end;
$$;

alter table shops        enable row level security;
alter table parts        enable row level security;
alter table inventory    enable row level security;
alter table transactions enable row level security;

-- ---------------------------------------------------------------------------
-- parts: shared public catalog, readable by everyone. Writes are server-only
-- (catalog is seeded; shops do not invent SKUs in this build).
-- ---------------------------------------------------------------------------
drop policy if exists parts_read_all on parts;
create policy parts_read_all on parts
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- shops: a signed-in shop can read every shop row (needed to render search
-- results and the map) but can only update its own.
-- ---------------------------------------------------------------------------
drop policy if exists shops_read_all on shops;
create policy shops_read_all on shops
  for select to authenticated using (current_shop_id() is not null);

drop policy if exists shops_update_own on shops;
create policy shops_update_own on shops
  for update to authenticated
  using (id = current_shop_id())
  with check (id = current_shop_id());

-- ---------------------------------------------------------------------------
-- inventory: readable across shops (that is the whole product), writable only
-- by the owning shop.
-- ---------------------------------------------------------------------------
drop policy if exists inventory_read_all on inventory;
create policy inventory_read_all on inventory
  for select to authenticated using (current_shop_id() is not null);

drop policy if exists inventory_write_own on inventory;
create policy inventory_write_own on inventory
  for all to authenticated
  using (shop_id = current_shop_id())
  with check (shop_id = current_shop_id());

-- ---------------------------------------------------------------------------
-- transactions: a shop sees only rows it is a party to (either side).
-- Inserts must name the caller as a party. Payment-state transitions
-- (paid / on_hold / released) are written by the Razorpay webhook using the
-- service_role key, never by a client.
-- ---------------------------------------------------------------------------
drop policy if exists transactions_read_own on transactions;
create policy transactions_read_own on transactions
  for select to authenticated
  using (seller_shop_id = current_shop_id() or buyer_shop_id = current_shop_id());

drop policy if exists transactions_insert_own on transactions;
create policy transactions_insert_own on transactions
  for insert to authenticated
  with check (seller_shop_id = current_shop_id() or buyer_shop_id = current_shop_id());
