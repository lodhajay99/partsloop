#!/usr/bin/env node
/**
 * Tiny migration runner for the hackathon.
 *
 *   node scripts/db.mjs push    # apply every supabase/migrations/*.sql in order
 *   node scripts/db.mjs seed    # load supabase/seed.sql
 *   node scripts/db.mjs reset   # roll every *.down.sql back, then push + seed
 *
 * Needs SUPABASE_DB_URL (Supabase → Project Settings → Database → Connection
 * string → URI, with your password filled in). If you would rather not wire
 * that up, paste the same files into the Supabase SQL editor by hand — the
 * order is the filename order.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import pg from 'pg';

import { requireDbUrl, sslFor } from './lib/db-url.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// Next.js reads .env.local, so this script must too — `dotenv/config` alone
// only picks up .env, which is not where the setup instructions send people.
// First file wins; dotenv never overwrites an already-set variable.
dotenv.config({ path: join(here, '..', '.env.local'), quiet: true });
dotenv.config({ path: join(here, '..', '.env'), quiet: true });
const migrationsDir = join(here, '..', 'supabase', 'migrations');
// Rollbacks live in a subdirectory so the Supabase CLI, which applies every
// .sql file it finds in supabase/migrations, never runs them by accident.
const downDir = join(migrationsDir, 'down');
const seedFile = join(here, '..', 'supabase', 'seed.sql');

const command = process.argv[2] ?? 'push';
const connectionString = requireDbUrl(process.env.SUPABASE_DB_URL);

function migrationFiles({ down = false } = {}) {
  const dir = down ? downDir : migrationsDir;
  const all = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return down ? all.reverse() : all;
}

async function run(client, label, sql) {
  process.stdout.write(`  ${label} … `);
  await client.query(sql);
  console.log('ok');
}

const client = new pg.Client({ connectionString, ssl: sslFor(connectionString) });

await client.connect();

try {
  if (command === 'reset') {
    console.log('Rolling back:');
    for (const file of migrationFiles({ down: true })) {
      await run(client, file, readFileSync(join(downDir, file), 'utf8'));
    }
  }

  if (command === 'push' || command === 'reset') {
    console.log('Applying migrations:');
    for (const file of migrationFiles()) {
      await run(client, file, readFileSync(join(migrationsDir, file), 'utf8'));
    }
  }

  if (command === 'seed' || command === 'reset') {
    console.log('Seeding:');
    await run(client, 'seed.sql', readFileSync(seedFile, 'utf8'));

    const { rows } = await client.query(
      `select (select count(*) from shops) as shops,
              (select count(*) from parts) as parts,
              (select count(*) from inventory) as inventory,
              (select count(*) from transactions) as transactions`,
    );
    console.log('  ', rows[0]);
  }

  if (!['push', 'seed', 'reset'].includes(command)) {
    console.error(`Unknown command "${command}". Use push, seed or reset.`);
    process.exitCode = 1;
  }
} catch (err) {
  console.log('failed');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
