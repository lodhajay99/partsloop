#!/usr/bin/env node
/**
 * Schema smoke test — `npm run db:verify`.
 *
 * Spins up an ephemeral in-process Postgres (PGlite), applies every migration
 * and the seed, then asserts the things that are easy to get quietly wrong:
 * that fuzzy search actually resolves misspellings and Hindi-English aliases,
 * that Haversine distances are sane, that the demo carve-outs held, and that
 * the constraints reject malformed ledger rows.
 *
 * This runs against real Postgres semantics, so a pass here means the SQL will
 * apply to Supabase. Supabase's anon/authenticated/service_role roles do not
 * exist in a bare Postgres, so the harness creates them first — which also lets
 * the RLS policies be exercised for real rather than eyeballed.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

import { billChecks } from './checks/bills.mjs';
import { cancelChecks } from './checks/cancel.mjs';
import { declineChecks } from './checks/decline.mjs';
import { processingFeeChecks } from './checks/processing-fee.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'supabase', 'migrations');
const seedFile = join(here, '..', 'supabase', 'seed.sql');

let failures = 0;

function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// PGlite dumps its whole bundled module into stack traces; keep failures readable.
process.on('uncaughtException', (err) => {
  console.error(`
UNCAUGHT: ${err.message}`);
  if (err.query) console.error(`  while running: ${String(err.query).slice(0, 200)}`);
  process.exit(1);
});

const db = await PGlite.create({ extensions: { pg_trgm, pgcrypto } });

// Supabase ships these roles; a bare Postgres does not. Creating them here lets
// 0003_rls.sql apply unchanged and lets the policies below be tested for real.
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
`);

console.log('Applying migrations:');
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  console.log(`  applied ${file}`);
}

console.log('Seeding:');
await db.exec(readFileSync(seedFile, 'utf8'));

const counts = (
  await db.query(`select
    (select count(*)::int from shops) as shops,
    (select count(*)::int from parts) as parts,
    (select count(*)::int from inventory) as inventory,
    (select count(*)::int from transactions) as transactions`)
).rows[0];
console.log('  ', counts);

console.log('\nSeed shape:');
check('6 shops seeded', counts.shops === 6, `got ${counts.shops}`);
check('42 parts seeded', counts.parts === 42, `got ${counts.parts}`);
check('inventory has gaps, not a full grid', counts.inventory > 100 && counts.inventory < 252,
  `${counts.inventory} of ${counts.shops * counts.parts} possible`);
// The seed fills the current month up to today, so on the 1st there is
// legitimately only one day of it. Scale the expectation with the calendar
// rather than asserting a fixed floor that breaks every month rollover.
const elapsedDays = new Date().getDate();
check(
  'the ledger is filled for every elapsed day of the month',
  counts.transactions >= elapsedDays * 6,
  `${counts.transactions} rows across ${elapsedDays} day(s), 6 shops`,
);

const shopA = (await db.query(`select * from shops where name = 'Shree Auto Spares'`)).rows[0];
const heroPart = (
  await db.query(`select * from parts where canonical_name = 'Hyundai i20 2018 Front Brake Pad Set'`)
).rows[0];

const heroAtShopA = (
  await db.query(`select count(*)::int as n from inventory where shop_id = $1 and part_id = $2`, [
    shopA.id,
    heroPart.id,
  ])
).rows[0].n;
check('demo shop is OUT of the hero part', heroAtShopA === 0);

const heroElsewhere = (
  await db.query(`select count(*)::int as n from inventory where part_id = $1 and quantity > 0`, [
    heroPart.id,
  ])
).rows[0].n;
check('at least 3 other shops stock the hero part', heroElsewhere >= 3, `${heroElsewhere} shops`);

// ---------------------------------------------------------------------------
// Distances
// ---------------------------------------------------------------------------
console.log('\nDistance:');
const spread = (
  await db.query(`select max(public.distance_km(a.lat, a.lng, b.lat, b.lng)) as max_km
                  from shops a cross join shops b`)
).rows[0].max_km;
check('all shops within ~5 km of each other', spread > 0.5 && spread < 5, `max ${spread.toFixed(2)} km`);

const knownPair = (
  await db.query(`select public.distance_km(
    (select lat from shops where name = 'Shree Auto Spares'),
    (select lng from shops where name = 'Shree Auto Spares'),
    (select lat from shops where name = 'Pune Spare Centre'),
    (select lng from shops where name = 'Pune Spare Centre')) as km`)
).rows[0].km;
check('Shivajinagar -> Camp is ~3-4 km', knownPair > 2.5 && knownPair < 4.5, `${knownPair.toFixed(2)} km`);

// ---------------------------------------------------------------------------
// Fuzzy search — the queries a shop owner actually types
// ---------------------------------------------------------------------------
console.log('\nFuzzy search from the demo shop:');

async function search(q, radius = 25) {
  const { rows } = await db.query(
    `select part_name, shop_name, quantity, price_paise, distance_km, match_score
       from public.search_available_parts($1, $2, $3, 25)`,
    [q, shopA.id, radius],
  );
  return rows;
}

const cases = [
  ['i20 brake pad', 'Hyundai i20 2018 Front Brake Pad Set', 'plain alias'],
  ['i20 brek pad', 'Hyundai i20 2018 Front Brake Pad Set', 'misspelling'],
  ['aage ka brake pad i20', 'Hyundai i20 2018 Front Brake Pad Set', 'Hindi-English alias'],
  ['creta hawa filter', 'Hyundai Creta 1.6 Air Filter', 'Hindi-English alias'],
  ['wagonar shoker', 'Maruti Wagon R Front Shock Absorber', 'double misspelling'],
  ['amron battery', 'Amaron 12V 45Ah Car Battery', 'brand misspelling'],
  ['swift radietor', 'Maruti Swift Radiator Assembly', 'misspelling'],
  ['sperk plug', 'NGK Iridium Spark Plug Set of 4', 'partial + misspelling'],
];

for (const [query, expected, kind] of cases) {
  const rows = await search(query);
  const hit = rows.some((r) => r.part_name === expected);
  check(
    `"${query}" (${kind}) finds ${expected.slice(0, 34)}…`,
    hit,
    hit ? `${rows.length} results, top score ${rows[0]?.match_score?.toFixed(2)}` : `${rows.length} results`,
  );
}

console.log('\nSearch behaviour:');
const heroRows = await search('i20 brake pad');
check('never returns the searching shop itself',
  heroRows.every((r) => r.shop_name !== 'Shree Auto Spares'));
check('results are sorted by match score then distance',
  heroRows.every((r, i) => i === 0 || heroRows[i - 1].match_score >= r.match_score));
check('only in-stock rows come back', heroRows.every((r) => r.quantity > 0));
check('empty query returns nothing', (await search('')).length === 0);
check('nonsense query returns nothing', (await search('zzzz qwertyuiop')).length === 0);

const tight = await search('i20 brake pad', 2);
check('radius filter actually filters',
  tight.length > 0 && tight.length < heroRows.length && tight.every((r) => r.distance_km <= 2),
  `${tight.length} within 2 km vs ${heroRows.length} within 25 km`);

// The relative cutoff should make an exact-ish query return a tight list rather
// than every brake pad in the catalog.
check('a specific query returns a focused result set', heroRows.length <= 8,
  `${heroRows.length} results: ${[...new Set(heroRows.map((r) => r.part_name))].join(' | ')}`);
check('every returned part is plausibly the one asked for',
  heroRows.every((r) => /brake pad/i.test(r.part_name)),
  [...new Set(heroRows.map((r) => r.part_name))].join(' | '));

const vague = await search('filter');
check('a vague query still offers alternatives', vague.length >= 3,
  `${vague.length} results across ${new Set(vague.map((r) => r.part_name)).size} parts`);

// ---------------------------------------------------------------------------
// Catalog search (inventory picker)
// ---------------------------------------------------------------------------
console.log('\nCatalog search:');
const catalog = (await db.query(`select canonical_name from public.search_parts('swift brek ped', 5)`))
  .rows;
check('catalog search tolerates misspellings',
  catalog.some((r) => r.canonical_name === 'Maruti Swift 2015-2019 Front Brake Pad Set'),
  catalog.map((r) => r.canonical_name).join(' | ') || 'no rows');

// ---------------------------------------------------------------------------
// Ledger constraints
// ---------------------------------------------------------------------------
console.log('\nLedger constraints:');

async function rejects(label, sql, params) {
  try {
    await db.query(sql, params);
    check(label, false, 'the database accepted it');
  } catch {
    check(label, true);
  }
}

const otherShop = (await db.query(`select id from shops where name = 'Balaji Motor Parts'`)).rows[0];

await rejects(
  'a retail sale cannot name a buyer shop',
  `insert into transactions (type, seller_shop_id, buyer_shop_id, part_id, quantity, amount_paise)
   values ('retail_sale', $1, $2, $3, 1, 1000)`,
  [shopA.id, otherShop.id, heroPart.id],
);

await rejects(
  'a shop-to-shop purchase must name a buyer',
  `insert into transactions (type, seller_shop_id, part_id, quantity, amount_paise)
   values ('inter_shop_purchase', $1, $2, 1, 1000)`,
  [shopA.id, heroPart.id],
);

await rejects(
  'a shop cannot buy from itself',
  `insert into transactions (type, seller_shop_id, buyer_shop_id, part_id, quantity, amount_paise)
   values ('inter_shop_purchase', $1, $1, $2, 1, 1000)`,
  [shopA.id, heroPart.id],
);

await rejects(
  'unknown statuses are rejected',
  `insert into transactions (type, seller_shop_id, part_id, quantity, amount_paise, status)
   values ('retail_sale', $1, $2, 1, 1000, 'definitely_not_a_status')`,
  [shopA.id, heroPart.id],
);

await rejects(
  'stock cannot go negative',
  `update inventory set quantity = -1 where shop_id = $1`,
  [shopA.id],
);

// ---------------------------------------------------------------------------
// consume_stock + reservation expiry
// ---------------------------------------------------------------------------
console.log('\nInventory + reservation mechanics:');

const line = (
  await db.query(
    `select part_id, quantity from inventory where shop_id = $1 and quantity >= 3 limit 1`,
    [shopA.id],
  )
).rows[0];

const after = (
  await db.query(`select public.consume_stock($1, $2, 2) as remaining`, [shopA.id, line.part_id])
).rows[0].remaining;
check('consume_stock decrements by the sold quantity', after === line.quantity - 2,
  `${line.quantity} -> ${after}`);

const floored = (
  await db.query(`select public.consume_stock($1, $2, 9999) as remaining`, [shopA.id, line.part_id])
).rows[0].remaining;
check('consume_stock floors at zero rather than going negative', floored === 0, `got ${floored}`);

const missing = (
  await db.query(`select public.consume_stock($1, $2, 1) as remaining`, [
    shopA.id,
    heroPart.id, // shop A does not stock this
  ])
).rows[0].remaining;
check('consume_stock reports -1 when there is no stock line', missing === -1, `got ${missing}`);

await db.query(
  `insert into transactions (type, seller_shop_id, buyer_shop_id, part_id, quantity, amount_paise, status, hold_until)
   values ('inter_shop_purchase', $1, $2, $3, 1, 1000, 'reserved', now() - interval '1 minute')`,
  [otherShop.id, shopA.id, heroPart.id],
);
await db.query(
  `insert into transactions (type, seller_shop_id, buyer_shop_id, part_id, quantity, amount_paise, status, hold_until)
   values ('inter_shop_purchase', $1, $2, $3, 1, 1000, 'reserved', now() + interval '20 minutes')`,
  [otherShop.id, shopA.id, heroPart.id],
);

const expired = (await db.query(`select public.expire_stale_reservations() as n`)).rows[0].n;
check('expire_stale_reservations expires exactly the lapsed one', expired === 1, `expired ${expired}`);

const stillLive = (
  await db.query(`select count(*)::int as n from transactions where status = 'reserved'`)
).rows[0].n;
check('a live reservation survives the sweep', stillLive === 1, `${stillLive} still reserved`);

// ---------------------------------------------------------------------------
// Row Level Security
// ---------------------------------------------------------------------------
console.log('\nRow Level Security:');

/** Runs a query as `authenticated`, optionally carrying a shop_id JWT claim. */
async function asAuthenticated(sql, claimShopId) {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      claimShopId ? JSON.stringify({ shop_id: claimShopId }) : '',
    ]);
    await db.exec('set local role authenticated');
    return (await db.query(sql)).rows;
  } finally {
    await db.exec('rollback');
  }
}

const rlsOn = (
  await db.query(`select count(*)::int as n from pg_class
                  where relname in ('shops','parts','inventory','transactions') and relrowsecurity`)
).rows[0].n;
check('RLS is enabled on all four tables', rlsOn === 4, `${rlsOn}/4`);

const noClaim = await asAuthenticated('select count(*)::int as n from transactions');
check('no JWT claim sees zero transactions', noClaim[0].n === 0, `saw ${noClaim[0].n}`);

const noClaimShops = await asAuthenticated('select count(*)::int as n from shops');
check('no JWT claim sees zero shops', noClaimShops[0].n === 0, `saw ${noClaimShops[0].n}`);

const anyoneParts = await asAuthenticated('select count(*)::int as n from parts');
check('the parts catalog stays publicly readable', anyoneParts[0].n === 42, `saw ${anyoneParts[0].n}`);

const mine = await asAuthenticated('select count(*)::int as n from transactions', shopA.id);
const minePlain = (
  await db.query(
    `select count(*)::int as n from transactions where seller_shop_id = $1 or buyer_shop_id = $1`,
    [shopA.id],
  )
).rows[0].n;
check('a shop sees exactly its own transactions', mine[0].n === minePlain && mine[0].n > 0,
  `${mine[0].n} via RLS vs ${minePlain} actual`);

const notMine = await asAuthenticated(
  `select count(*)::int as n from transactions
    where seller_shop_id <> '${shopA.id}' and (buyer_shop_id is null or buyer_shop_id <> '${shopA.id}')`,
  shopA.id,
);
check("a shop cannot see other shops' transactions", notMine[0].n === 0, `leaked ${notMine[0].n}`);

const inventoryVisible = await asAuthenticated('select count(*)::int as n from inventory', shopA.id);
check('inventory stays readable across shops (search needs it)',
  inventoryVisible[0].n === counts.inventory, `${inventoryVisible[0].n}/${counts.inventory}`);

/**
 * Runs a write as `authenticated` and reports what RLS did with it.
 * A policy that filters rather than raises returns affectedRows: 0 — that is a
 * refusal too, and the assertions below have to accept both shapes.
 */
async function writeAs(sql, claimShopId) {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ shop_id: claimShopId }),
    ]);
    await db.exec('set local role authenticated');
    const res = await db.query(sql);
    return { raised: false, affected: res.affectedRows ?? 0 };
  } catch (err) {
    return { raised: true, affected: 0, message: err.message };
  } finally {
    await db.exec('rollback');
  }
}

const foreignUpdate = await writeAs(
  `update inventory set quantity = 999 where shop_id = '${otherShop.id}'`,
  shopA.id,
);
check("a shop cannot edit another shop's stock", foreignUpdate.affected === 0,
  `${foreignUpdate.affected} rows would have changed`);

const ownUpdate = await writeAs(
  `update inventory set quantity = quantity where shop_id = '${shopA.id}'`,
  shopA.id,
);
check('a shop CAN edit its own stock', !ownUpdate.raised && ownUpdate.affected > 0,
  ownUpdate.raised ? ownUpdate.message : `${ownUpdate.affected} rows`);

const foreignInsert = await writeAs(
  `insert into transactions (type, seller_shop_id, buyer_shop_id, part_id, quantity, amount_paise)
   values ('inter_shop_purchase', '${otherShop.id}',
           (select id from shops where name = 'Khan Auto Agencies'), '${heroPart.id}', 1, 100)`,
  shopA.id,
);
check('a shop cannot insert a transaction it is not party to', foreignInsert.raised);

const ownInsert = await writeAs(
  `insert into transactions (type, seller_shop_id, buyer_shop_id, part_id, quantity, amount_paise)
   values ('inter_shop_purchase', '${otherShop.id}', '${shopA.id}', '${heroPart.id}', 1, 100)`,
  shopA.id,
);
check('a shop CAN insert a transaction it is party to', !ownInsert.raised,
  ownInsert.message ?? '');

const clientSettle = await writeAs(
  `update transactions set status = 'paid' where buyer_shop_id = '${shopA.id}'`,
  shopA.id,
);
check('a client cannot mark its own purchase paid (no UPDATE grant)', clientSettle.raised,
  clientSettle.raised ? '' : `${clientSettle.affected} rows would have changed`);

await billChecks({ db, check, rejects, shopA, otherShop });
await cancelChecks({ db, check, shopA, otherShop });
await processingFeeChecks({ db, check, rejects, shopA });
await declineChecks({ db, check, shopA, otherShop });

// ---------------------------------------------------------------------------
// Who may release the settlement hold
//
// The hold exists so the buyer's money is not handed to the seller before the
// part is. A seller who could release it themselves would defeat the entire
// mechanism, and neither guard is reachable from SQL, so assert both are still
// in the source: the server rule, and the button that must never be offered to
// the wrong side.
// ---------------------------------------------------------------------------
console.log('\nRelease authorisation:');

const fulfilmentSrc = readFileSync(join(here, '..', 'src', 'lib', 'data', 'fulfilment.ts'), 'utf8');
check(
  'releaseHold refuses any shop that is not the buyer',
  /if\s*\(tx\.buyer_shop_id\s*!==\s*actingShopId\)\s*\{[\s\S]{0,120}?throw/.test(fulfilmentSrc),
);

const actionsSrc = readFileSync(
  join(here, '..', 'src', 'components', 'transactions', 'transaction-actions.tsx'),
  'utf8',
);
check(
  'the release button is gated on the acting shop being the buyer',
  /const canRelease\s*=\s*isBuyer\s*&&/.test(actionsSrc),
);

// ---------------------------------------------------------------------------
// A settled trade returns the row to open search
//
// Search reveals a seller for longer than a reservation stays live: once you
// have bought from a shop you keep seeing its name. Those two windows must not
// be the same set, or a finished trade leaves the row offering "Open
// reservation" forever and the part can never be bought there again.
// ---------------------------------------------------------------------------
console.log('\nSettled trades return to open search:');

const searchSrc = readFileSync(join(here, '..', 'src', 'lib', 'data', 'search.ts'), 'utf8');
const liveBlock = searchSrc.match(/LIVE_RESERVATION_STATUSES[^=]*=\s*new Set\(\[([^\]]*)\]/);

check('search defines a live-reservation set distinct from the revealing one', Boolean(liveBlock));
check(
  'a released or completed trade is not treated as a live reservation',
  Boolean(liveBlock) && !/released|completed/.test(liveBlock[1]),
  liveBlock ? liveBlock[1].replace(/\s+/g, ' ').trim() : 'not found',
);
check(
  'the reservation surfaced to search is gated on it being live',
  /reservation_id:\s*live\s*\?/.test(searchSrc),
);

// ---------------------------------------------------------------------------
// PostgREST foreign-key hints used by the app
//
// src/lib/data/*.ts embeds related rows with `part:parts!<constraint>(...)`.
// Those constraint names are generated by Postgres, so a rename in a migration
// breaks the query at runtime with nothing at build time to catch it. Scrape
// them out of the source and confirm each one really exists.
// ---------------------------------------------------------------------------
console.log('\nPostgREST embed hints:');

const srcDir = join(here, '..', 'src', 'lib', 'data');
const hints = new Set();
for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.ts'))) {
  const text = readFileSync(join(srcDir, file), 'utf8');
  for (const m of text.matchAll(/!([a-z_]+_fkey)/g)) hints.add(m[1]);
}

const known = new Set(
  (await db.query(`select conname from pg_constraint where contype = 'f'`)).rows.map((r) => r.conname),
);

check('the source references at least one embed hint', hints.size > 0, `${hints.size} found`);
for (const hint of [...hints].sort()) {
  check(`constraint ${hint} exists`, known.has(hint));
}

await db.close();

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
