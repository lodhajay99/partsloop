-- PartLoop seed: 6 shops in a ~3km cluster in Pune, 42 auto parts with messy
-- real-world aliases, patchy inventory (deliberate gaps), and a month of
-- backdated ledger history so the dashboard is alive on first load.
--
-- Idempotent: safe to re-run. Wipes and rebuilds everything.

begin;

truncate table bills, transactions, inventory, parts, shops restart identity cascade;

-- ---------------------------------------------------------------------------
-- Shops. Real Pune coordinates, all within ~3 km of each other.
-- razorpay_linked_account_id: 'acc_MOCK*' means Route onboarding was NOT done
-- (no KYC in a hackathon). The UI flags any transfer against these as a
-- "simulated Route split". Replace with real acc_* ids to go live.
-- ---------------------------------------------------------------------------
insert into shops (name, owner_phone, lat, lng, address, razorpay_linked_account_id) values
  ('Shree Auto Spares',    '+919876543201', 18.53080, 73.84750, 'Shop 12, Ganeshkhind Road, Shivajinagar, Pune 411005', 'acc_MOCK0000000001'),
  ('Balaji Motor Parts',   '+919876543202', 18.51670, 73.84100, '4 Bhandarkar Road, Deccan Gymkhana, Pune 411004',      'acc_MOCK0000000002'),
  ('Khan Auto Agencies',   '+919876543203', 18.50890, 73.83200, '221 Karve Road, Erandwane, Pune 411004',               'acc_MOCK0000000003'),
  ('Sai Nath Auto Parts',  '+919876543204', 18.50890, 73.85000, '9 Tilak Road, Sadashiv Peth, Pune 411030',             'acc_MOCK0000000004'),
  ('Pune Spare Centre',    '+919876543205', 18.51700, 73.87850, '31 MG Road, Camp, Pune 411001',                        'acc_MOCK0000000005'),
  ('Gurukrupa Auto Store', '+919876543206', 18.52900, 73.83300, '7 Modern College Road, Model Colony, Pune 411016',     'acc_MOCK0000000006');

-- ---------------------------------------------------------------------------
-- Parts catalog + reference prices.
-- Aliases are intentionally messy: mixed Hindi-English ("aage ka brake pad"),
-- model/year variants, and common misspellings ("brek pad", "shoker").
-- ---------------------------------------------------------------------------
create temporary table seed_parts (
  canonical_name text primary key,
  aliases text[],
  category text,
  base_price_paise int
) on commit drop;

insert into seed_parts values
  ('Hyundai i20 2018 Front Brake Pad Set',       '{"i20 brake pad","i20 2018 brake pad front","i20 brek pad","aage ka brake pad i20"}', 'brake', 248000),
  ('Maruti Swift 2015-2019 Front Brake Pad Set', '{"swift brake pad","swift front pad","swift brek ped","swift 2017 brake pad"}',       'brake', 189000),
  ('Maruti Alto 800 Rear Brake Shoe Set',        '{"alto brake shoe","alto 800 shoe","alto piche ka brake","alto brek shoe"}',          'brake', 92000),
  ('Honda City 2017 Front Brake Disc Rotor',     '{"city disc","honda city rotor","city brake disc 2017","city disk"}',                 'brake', 312000),
  ('Tata Nexon Front Brake Pad Set',             '{"nexon brake pad","nexon pad set","nexon front pad"}',                               'brake', 226000),
  ('Mahindra Scorpio Rear Brake Shoe Set',       '{"scorpio brake shoe","scorpio shoe set","scorpio piche brake"}',                     'brake', 148000),
  ('Mahindra XUV500 Brake Master Cylinder',      '{"xuv500 master cylinder","xuv brake master","xuv 500 master silender"}',             'brake', 289000),
  ('Maruti Baleno Oil Filter',                   '{"baleno oil filter","baleno filter","baleno oil filtar","baleno ka oil filter"}',    'filter', 32000),
  ('Hyundai Creta 1.6 Air Filter',               '{"creta air filter","creta hawa filter","creta 1.6 filter","kreta air filter"}',      'filter', 54000),
  ('Maruti Swift Diesel Fuel Filter',            '{"swift diesel filter","swift fuel filter","swift dizel filter"}',                    'filter', 78000),
  ('Honda Amaze Cabin AC Filter',                '{"amaze ac filter","amaze cabin filter","amaze ac ka filter"}',                       'filter', 44000),
  ('Toyota Innova Crysta Oil Filter',            '{"innova oil filter","crysta filter","innova crysta filtar"}',                        'filter', 41000),
  ('Mahindra Bolero Air Filter',                 '{"bolero air filter","bolero hawa filter","bolero filter"}',                          'filter', 36000),
  ('Maruti Wagon R Front Shock Absorber',        '{"wagonr shocker","wagon r front shocker","wagonar shoker","wagon r aage shocker"}',  'suspension', 214000),
  ('Hyundai i10 Rear Shock Absorber',            '{"i10 rear shocker","i10 piche shocker","i10 back shoker"}',                          'suspension', 186000),
  ('Honda City Front Lower Suspension Arm',      '{"city lower arm","city suspension arm","city lowar arm"}',                           'suspension', 268000),
  ('Maruti Ertiga Front Stabilizer Link',        '{"ertiga link rod","ertiga stabilizer","ertiga link rood"}',                          'suspension', 96000),
  ('Tata Tiago Front Coil Spring',               '{"tiago coil spring","tiago spring","tiago front spring"}',                           'suspension', 172000),
  ('Exide 12V 35Ah Car Battery',                 '{"exide battery","exide 35ah","car battery exide","exide 12v battery"}',              'electrical', 468000),
  ('Amaron 12V 45Ah Car Battery',                '{"amaron battery","amaron 45ah","amron battery","amaron 12v"}',                       'electrical', 592000),
  ('Bosch H4 Halogen Headlight Bulb 60/55W',     '{"h4 bulb","bosch headlight bulb","h4 halogen","hedlight bulb h4"}',                  'electrical', 38000),
  ('Maruti Swift Alternator Assembly',           '{"swift alternator","swift dynamo","swift altarnator"}',                              'electrical', 682000),
  ('Hyundai i20 Starter Motor',                  '{"i20 starter","i20 self motor","i20 self","i20 startar"}',                           'electrical', 548000),
  ('Honda City Ignition Coil',                   '{"city coil","honda city ignition coil","city ignition koil"}',                       'electrical', 142000),
  ('NGK Iridium Spark Plug Set of 4',            '{"ngk spark plug","spark plug set","sperk plug ngk","ngk plug"}',                     'engine', 164000),
  ('Maruti Swift Timing Belt Kit',               '{"swift timing belt","swift belt kit","swift timming belt"}',                         'engine', 328000),
  ('Hyundai i20 Engine Mounting',                '{"i20 engine mounting","i20 mounting","i20 engin mounting"}',                         'engine', 124000),
  ('Tata Indica Cylinder Head Gasket',           '{"indica head gasket","indica gasket","indica hed gasket"}',                          'engine', 178000),
  ('Maruti Alto Clutch Plate Set',               '{"alto clutch plate","alto clutch","alto klutch plate"}',                             'clutch', 242000),
  ('Hyundai i20 Clutch Release Bearing',         '{"i20 release bearing","i20 clutch bearing","i20 clutch baring"}',                    'clutch', 94000),
  ('Honda City Clutch Cable',                    '{"city clutch cable","city clutch wire","city klutch cable"}',                        'clutch', 56000),
  ('Maruti Swift Radiator Assembly',             '{"swift radiator","swift radietor","swift radiator assembly"}',                       'cooling', 428000),
  ('Hyundai Creta Radiator Cooling Fan',         '{"creta fan","creta radiator fan","creta cooling fan","kreta fan"}',                  'cooling', 324000),
  ('Honda Amaze Water Pump',                     '{"amaze water pump","amaze pump","amaze watar pump"}',                                'cooling', 226000),
  ('Maruti Baleno Front Bumper',                 '{"baleno bumper","baleno front bumper","baleno bumpar"}',                             'body', 386000),
  ('Hyundai i20 Left Side Mirror Assembly',      '{"i20 side mirror","i20 left mirror","i20 mirror left","i20 saide mirror"}',          'body', 264000),
  ('Honda City Headlight Assembly Right',        '{"city headlight","city head light right","city headlite","city hedlight"}',          'body', 452000),
  ('Maruti Wagon R Tail Light Assembly',         '{"wagonr tail light","wagon r back light","wagonr taillite"}',                        'body', 218000),
  ('Tata Nexon Windshield Wiper Blade Set',      '{"nexon wiper","nexon wiper blade","nexon wipar"}',                                   'body', 72000),
  ('Maruti Swift Front Wheel Bearing',           '{"swift wheel bearing","swift bearing front","swift wheel baring"}',                  'transmission', 112000),
  ('Hyundai i10 CV Joint Axle Assembly',         '{"i10 cv joint","i10 axle","i10 drive shaft","i10 cv joint axel"}',                   'transmission', 486000),
  ('Honda City Gear Cable Set',                  '{"city gear cable","city gear wire","city gear kebal"}',                              'transmission', 96000);

insert into parts (canonical_name, aliases, category)
select canonical_name, aliases, category from seed_parts;

-- ---------------------------------------------------------------------------
-- Inventory: each shop stocks a deterministic ~60% slice of the catalog at a
-- +/-12% price spread, verified anywhere from minutes to ~3 days ago.
-- The gaps are the point: no shop has everything.
-- ---------------------------------------------------------------------------
insert into inventory (shop_id, part_id, quantity, price_paise, last_verified_at)
select
  b.shop_id,
  b.part_id,
  1 + (b.h % 8),
  (b.base_price_paise * (0.88 + ((b.h / 13) % 25)::numeric / 100))::int,
  now() - (((b.h / 7) % 4300) || ' minutes')::interval
from (
  select
    s.id as shop_id,
    p.id as part_id,
    sp.base_price_paise,
    abs(hashtext(s.name || '|' || p.canonical_name)) as h
  from shops s
  cross join parts p
  join seed_parts sp on sp.canonical_name = p.canonical_name
) b
where (b.h % 10) < 6;

-- --- Demo carve-outs: guarantee the "found it nearby" moment is real ---------

-- Shop A (Shree Auto Spares) is OUT of the hero part.
delete from inventory
where shop_id = (select id from shops where name = 'Shree Auto Spares')
  and part_id = (select id from parts where canonical_name = 'Hyundai i20 2018 Front Brake Pad Set');

-- Three nearby shops have it, at different prices and freshness.
insert into inventory (shop_id, part_id, quantity, price_paise, last_verified_at)
select s.id, p.id, v.qty, v.price, now() - (v.mins || ' minutes')::interval
from (values
  ('Balaji Motor Parts', 4, 239000, 14),
  ('Khan Auto Agencies', 2, 255000, 185),
  ('Pune Spare Centre',  6, 228000, 1490)
) as v(shop_name, qty, price, mins)
join shops s on s.name = v.shop_name
cross join (select id from parts where canonical_name = 'Hyundai i20 2018 Front Brake Pad Set') p
on conflict (shop_id, part_id)
do update set quantity = excluded.quantity,
              price_paise = excluded.price_paise,
              last_verified_at = excluded.last_verified_at;

-- Give Shop A a couple of low-stock lines so the dashboard flag has teeth.
update inventory set quantity = 1
where shop_id = (select id from shops where name = 'Shree Auto Spares')
  and part_id in (
    select id from parts
    where canonical_name in ('Maruti Baleno Oil Filter', 'Bosch H4 Halogen Headlight Bulb 60/55W')
  );

-- ---------------------------------------------------------------------------
-- Counter-bill history for the current month.
--
-- Every walk-in sale is a bill with one to three lines, because that is what
-- actually happens at a counter: somebody buys a filter, a bulb and a wiper set
-- together and pays once. Each line is still its own `transactions` row, so the
-- dashboard's per-part figures are unaffected.
--
-- All of it is flagged is_seed = true and labelled "seed" in the UI: backdated
-- demo history, NOT real Razorpay payments. Anything created during the demo
-- itself goes through Razorpay for real.
-- ---------------------------------------------------------------------------
create temporary table seed_bills on commit drop as
select
  gen_random_uuid() as bill_id,
  slot.shop_id,
  slot.ts,
  row_number() over (partition by slot.shop_id order by slot.ts, slot.k) as bill_number
from (
  select
    s.id as shop_id,
    k.k::text as k,
    least(
      date_trunc('month', now())
        + (d.d || ' days')::interval
        + ((9 + (abs(hashtext(s.name || d.d::text || k.k::text)) % 10)) || ' hours')::interval
        + ((abs(hashtext(k.k::text || s.name || d.d::text)) % 60) || ' minutes')::interval,
      now() - interval '11 minutes'
    ) as ts
  from shops s
  cross join generate_series(0, extract(day from now())::int - 1) as d(d)
  cross join lateral generate_series(
    1, 1 + (abs(hashtext(s.name || 'vol' || d.d::text)) % 3)
  ) as k(k)
) slot;

-- Roughly half the counter takings come in as cash, which is what an
-- independent parts shop actually looks like. Cash bills carry no Razorpay ids,
-- because there is no Razorpay record behind them.
insert into bills (
  id, shop_id, bill_number, total_paise, status, payment_method,
  razorpay_order_id, razorpay_payment_id, simulated, is_seed,
  paid_at, stock_deducted_at, created_at
)
select
  b.bill_id,
  b.shop_id,
  b.bill_number,
  0,                                   -- filled in from the lines below
  'stocked',
  case when (abs(hashtext(b.bill_id::text || 'method')) % 100) < 55 then 'cash' else 'razorpay' end,
  case when (abs(hashtext(b.bill_id::text || 'method')) % 100) < 55
       then null else 'order_SEED' || substr(md5(b.bill_id::text), 1, 10) end,
  case when (abs(hashtext(b.bill_id::text || 'method')) % 100) < 55
       then null else 'pay_SEED' || substr(md5(b.bill_id::text || 'p'), 1, 12) end,
  (abs(hashtext(b.bill_id::text || 'method')) % 100) >= 55,
  true,
  b.ts,
  b.ts + interval '3 minutes',
  b.ts
from seed_bills b;

-- One to three distinct parts per bill, taken from what that shop stocks.
insert into transactions (
  type, seller_shop_id, part_id, quantity, amount_paise, status, bill_id, payment_method,
  razorpay_order_id, razorpay_payment_id, simulated, is_seed, created_at, paid_at
)
select
  'retail_sale',
  b.shop_id,
  pick.part_id,
  pick.qty,
  pick.price_paise * pick.qty,
  'completed',
  b.bill_id,
  bill.payment_method,
  bill.razorpay_order_id,
  bill.razorpay_payment_id,
  bill.simulated,
  true,
  b.ts,
  b.ts
from seed_bills b
join bills bill on bill.id = b.bill_id
cross join lateral (
  select
    i.part_id,
    i.price_paise,
    1 + (abs(hashtext(i.id::text || b.bill_id::text)) % 2) as qty
  from inventory i
  where i.shop_id = b.shop_id
  order by md5(i.id::text || b.bill_id::text)
  limit 1 + (abs(hashtext(b.bill_id::text || 'lines')) % 3)
) pick;

update bills b
   set total_paise = coalesce(
     (select sum(t.amount_paise) from transactions t where t.bill_id = b.id), 0
   )
 where b.is_seed;

-- A few completed shop-to-shop trades already in the books (2% platform fee).
insert into transactions (
  type, seller_shop_id, buyer_shop_id, part_id, quantity, amount_paise,
  platform_fee_paise, status, razorpay_order_id, razorpay_payment_id,
  razorpay_transfer_id, simulated, is_seed, created_at, paid_at, released_at
)
select
  'inter_shop_purchase',
  seller.id,
  buyer.id,
  pick.part_id,
  1,
  pick.price_paise,
  (pick.price_paise * 0.02)::int,
  'released',
  'order_SEED' || substr(md5(t.seller_name || t.buyer_name), 1, 10),
  'pay_SEED' || substr(md5(t.buyer_name || t.seller_name), 1, 12),
  'trf_SEED' || substr(md5(t.seller_name || 'x' || t.buyer_name), 1, 12),
  true,
  true,
  now() - (t.days_ago || ' days')::interval,
  now() - (t.days_ago || ' days')::interval + interval '6 minutes',
  now() - (t.days_ago || ' days')::interval + interval '2 hours'
from (values
  ('Balaji Motor Parts',   'Shree Auto Spares',   2),
  ('Khan Auto Agencies',   'Shree Auto Spares',   5),
  ('Shree Auto Spares',    'Sai Nath Auto Parts', 3),
  ('Shree Auto Spares',    'Pune Spare Centre',   8),
  ('Gurukrupa Auto Store', 'Balaji Motor Parts',  4),
  ('Pune Spare Centre',    'Khan Auto Agencies',  6)
) as t(seller_name, buyer_name, days_ago)
join shops seller on seller.name = t.seller_name
join shops buyer on buyer.name = t.buyer_name
cross join lateral (
  select i.part_id, i.price_paise
  from inventory i
  where i.shop_id = seller.id
  order by md5(i.id::text || t.buyer_name)
  limit 1
) pick
where now() - (t.days_ago || ' days')::interval >= date_trunc('month', now());

commit;

-- Sanity check
select
  (select count(*) from shops) as shops,
  (select count(*) from parts) as parts,
  (select count(*) from inventory) as inventory_rows,
  (select count(*) from bills) as bills,
  (select count(*) from transactions) as transactions;
