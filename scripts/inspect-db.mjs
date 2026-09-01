#!/usr/bin/env node
/**
 * Read-only look at whatever is already in the target database — `npm run db:inspect`.
 *
 * Worth running before `db:push`/`db:seed` against a project you did not create
 * empty: the seed truncates PartLoop's five tables, so this reports what is
 * there first and whether anything would be caught in the blast radius.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import pg from 'pg';

import { requireDbUrl, sslFor } from './lib/db-url.mjs';

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(here, '..', '.env.local'), quiet: true });
dotenv.config({ path: join(here, '..', '.env'), quiet: true });

const connectionString = requireDbUrl(process.env.SUPABASE_DB_URL);

const OURS = ['shops', 'parts', 'inventory', 'transactions', 'bills'];

const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);
const client = new pg.Client({ connectionString, ssl: sslFor(connectionString) });

await client.connect();

try {
  const { rows: version } = await client.query('select current_database() as db, version() as v');
  console.log(`Connected to ${version[0].db} (${isLocal ? 'local' : 'remote'})`);
  console.log(`  ${version[0].v.split(',')[0]}\n`);

  const { rows: tables } = await client.query(`
    select c.relname as name, coalesce(s.n_live_tup, 0) as rows
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_stat_user_tables s on s.relname = c.relname and s.schemaname = 'public'
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname
  `);

  if (tables.length === 0) {
    console.log('public schema: empty — safe to push and seed.');
  } else {
    console.log('Tables already in the public schema:');
    for (const t of tables) {
      const mine = OURS.includes(t.name);
      console.log(`  ${mine ? '[partloop]' : '[OTHER]  '} ${t.name.padEnd(24)} ~${t.rows} rows`);
    }

    const foreign = tables.filter((t) => !OURS.includes(t.name));
    console.log('');
    if (foreign.length > 0) {
      console.log(
        `WARNING: ${foreign.length} table(s) in this database do not belong to PartLoop.\n` +
          '         Migrations only create PartLoop tables and the seed only truncates\n' +
          '         PartLoop tables, so these are not touched — but confirm you meant to\n' +
          '         share a database before continuing.',
      );
    } else {
      console.log('Only PartLoop tables present.');
    }
  }

  const { rows: exts } = await client.query(
    `select extname from pg_extension where extname in ('pg_trgm','pgcrypto') order by extname`,
  );
  console.log(`\nExtensions present: ${exts.map((e) => e.extname).join(', ') || 'none of pg_trgm/pgcrypto yet'}`);
} finally {
  await client.end();
}
