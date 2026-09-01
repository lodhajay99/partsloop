-- PartLoop 0001: extensions + core schema
-- One concern per migration file. Reversible via 0001_schema.down.sql.

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- fuzzy part-name matching

-- ---------------------------------------------------------------------------
-- shops
-- Each shop is (in production) a Razorpay Route Linked Account.
-- razorpay_linked_account_id is nullable: when it is null or starts with
-- 'acc_MOCK', the app renders the Route split as SIMULATED in the UI.
-- ---------------------------------------------------------------------------
create table if not exists shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_phone text not null unique,
  lat double precision not null,
  lng double precision not null,
  address text,
  razorpay_linked_account_id text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- parts: the shared SKU layer. Deliberately messy names/aliases so search
-- has to do real matching work.
-- ---------------------------------------------------------------------------
create table if not exists parts (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  aliases text[] not null default '{}',
  category text not null default 'brake',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- inventory: per-shop stock
-- ---------------------------------------------------------------------------
create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  part_id uuid not null references parts(id) on delete cascade,
  quantity int not null default 0 check (quantity >= 0),
  price_paise int not null check (price_paise >= 0),
  last_verified_at timestamptz not null default now(),
  unique (shop_id, part_id)
);

-- ---------------------------------------------------------------------------
-- transactions: the single ledger. Retail sales AND inter-shop purchases.
-- The monthly dashboard reads from this table and nothing else.
-- ---------------------------------------------------------------------------
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('retail_sale', 'inter_shop_purchase')),
  seller_shop_id uuid not null references shops(id) on delete restrict,
  buyer_shop_id uuid references shops(id) on delete restrict,
  part_id uuid not null references parts(id) on delete restrict,
  quantity int not null check (quantity > 0),
  amount_paise int not null check (amount_paise >= 0),
  platform_fee_paise int not null default 0,
  razorpay_order_id text,
  razorpay_payment_id text,
  razorpay_payment_link_id text,
  razorpay_payment_link_url text,
  razorpay_transfer_id text,
  simulated boolean not null default false,   -- true when the Route/Razorpay call was mocked
  is_seed boolean not null default false,     -- true for demo history that never touched Razorpay
  status text not null default 'created'
    check (status in ('created','reserved','paid','on_hold','released','completed','expired','refunded')),
  hold_until timestamptz,
  paid_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  -- a retail sale has no buyer shop; an inter-shop purchase must have one
  constraint buyer_shape check (
    (type = 'retail_sale' and buyer_shop_id is null)
    or (type = 'inter_shop_purchase' and buyer_shop_id is not null and buyer_shop_id <> seller_shop_id)
  )
);
