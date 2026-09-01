-- PartLoop 0004: distance + fuzzy-search functions

-- Haversine great-circle distance in km. Plain trig, no PostGIS/earthdistance.
create or replace function public.distance_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
parallel safe
as $$
  select 6371.0 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ---------------------------------------------------------------------------
-- Scoring
--
-- A shop owner types "i20 brek pad" or "creta hawa filter", not the catalog
-- name. Four signals, best-of:
--   * similarity()      — whole-string trigram overlap, catches misspellings
--   * word_similarity() — best matching *portion* of the name, so a short query
--                         still scores against a long canonical name
--   * substring hits on the canonical name (0.95) and on the flattened alias
--     text (0.9), which is what the GIN index in 0002 accelerates
-- ---------------------------------------------------------------------------

-- Catalog search: used by the inventory editor's part picker.
create or replace function public.search_parts(
  p_query text,
  p_limit int default 15
)
returns table (
  id uuid,
  canonical_name text,
  aliases text[],
  category text,
  match_score real
)
language sql
stable
set search_path = public
as $$
  select s.id, s.canonical_name, s.aliases, s.category, s.match_score
  from (
    select
      p.id,
      p.canonical_name,
      p.aliases,
      p.category,
      greatest(
        similarity(p.canonical_name, p_query),
        word_similarity(p_query, p.canonical_name),
        coalesce((
          select max(greatest(similarity(a, p_query), word_similarity(p_query, a)))
          from unnest(p.aliases) as a
        ), 0),
        case when p.canonical_name ilike '%' || p_query || '%' then 0.95 else 0 end,
        case when public.aliases_text(p.aliases) ilike '%' || p_query || '%' then 0.9 else 0 end
      )::real as match_score
    from parts p
    where coalesce(nullif(trim(p_query), ''), '') <> ''
  ) s
  where s.match_score >= 0.25
  order by s.match_score desc, s.canonical_name asc
  limit p_limit;
$$;

-- Cross-shop availability search.
--
-- Fuzzy-matches the query to parts, joins to in-stock inventory at OTHER shops,
-- filters by Haversine radius, then keeps only results close to the best match
-- found. That relative cutoff matters: an absolute threshold alone lets "i20
-- brake pad" drag in every brake pad in the catalog, because "brake pad" really
-- does partially match all of them. Anchoring to the top score keeps the list
-- tight when there is a clear winner, and still shows alternatives when the
-- query is vague.
--
-- Shop identity is returned here but MASKED in the application layer until the
-- searching shop reserves — see src/lib/data/search.ts.
create or replace function public.search_available_parts(
  p_query text,
  p_shop_id uuid,
  p_radius_km double precision default 25,
  p_limit int default 25
)
returns table (
  inventory_id uuid,
  shop_id uuid,
  shop_name text,
  shop_address text,
  shop_lat double precision,
  shop_lng double precision,
  linked_account_id text,
  part_id uuid,
  part_name text,
  part_aliases text[],
  category text,
  quantity int,
  price_paise int,
  last_verified_at timestamptz,
  distance_km double precision,
  match_score real
)
language sql
stable
set search_path = public
as $$
  with me as (
    select s.lat as mlat, s.lng as mlng from shops s where s.id = p_shop_id
  ),
  matched as (
    select
      p.id as pid,
      p.canonical_name as pname,
      p.aliases as palias,
      p.category as pcat,
      greatest(
        similarity(p.canonical_name, p_query),
        word_similarity(p_query, p.canonical_name),
        coalesce((
          select max(greatest(similarity(a, p_query), word_similarity(p_query, a)))
          from unnest(p.aliases) as a
        ), 0),
        case when p.canonical_name ilike '%' || p_query || '%' then 0.95 else 0 end,
        case when public.aliases_text(p.aliases) ilike '%' || p_query || '%' then 0.9 else 0 end
      )::real as score
    from parts p
    where coalesce(nullif(trim(p_query), ''), '') <> ''
  ),
  candidates as (
    select
      i.id as inv_id,
      sh.id as sid,
      sh.name as sname,
      sh.address as saddr,
      sh.lat as slat,
      sh.lng as slng,
      sh.razorpay_linked_account_id as sacct,
      m.pid,
      m.pname,
      m.palias,
      m.pcat,
      i.quantity as qty,
      i.price_paise as price,
      i.last_verified_at as verified,
      public.distance_km(me.mlat, me.mlng, sh.lat, sh.lng) as dist,
      m.score
    from matched m
    cross join me
    join inventory i on i.part_id = m.pid and i.quantity > 0
    join shops sh on sh.id = i.shop_id
    where m.score >= 0.28
      and sh.id <> p_shop_id
      and public.distance_km(me.mlat, me.mlng, sh.lat, sh.lng) <= p_radius_km
  ),
  best as (
    select coalesce(max(c.score), 0)::real as top from candidates c
  )
  select
    c.inv_id, c.sid, c.sname, c.saddr, c.slat, c.slng, c.sacct,
    c.pid, c.pname, c.palias, c.pcat,
    c.qty, c.price, c.verified, c.dist, c.score
  from candidates c
  cross join best b
  where c.score >= greatest(0.32::real, b.top * 0.72::real)
  order by c.score desc, c.dist asc, c.verified desc
  limit p_limit;
$$;

-- Reservation TTL. The hackathon build calls this on page load rather than
-- running a cron job; swap to pg_cron in production.
create or replace function public.expire_stale_reservations()
returns int
language sql
volatile
set search_path = public
as $$
  with expired as (
    update transactions t
       set status = 'expired'
     where t.status in ('created', 'reserved')
       and t.hold_until is not null
       and t.hold_until < now()
    returning 1
  )
  select coalesce(count(*), 0)::int from expired;
$$;
