#!/usr/bin/env node
/**
 * Writes .env.local from a running local Supabase stack — `npm run env:local`.
 *
 * Run `npx supabase start` first. This reads the ports and keys that command
 * printed (via `supabase status -o env`) and fills in the Supabase half of
 * .env.local, leaving any Razorpay keys already in the file untouched — without
 * them the app runs in labelled simulated mode, which is a valid way to demo.
 */

import { execSync } from 'node:child_process';
import { existsSync as exists, readFileSync as read, writeFileSync as write } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env.local');

let raw;
try {
  // Fixed command string, no interpolation — execSync so the npx shim resolves
  // on Windows without handing argv to a shell.
  raw = execSync('npx --yes supabase@latest status -o env', {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch {
  console.error(
    'Could not read the local Supabase status.\n' +
      'Start it first:  npx supabase start',
  );
  process.exit(1);
}

const status = Object.fromEntries(
  raw
    .split('\n')
    .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const apiUrl = status.API_URL;
const serviceKey = status.SERVICE_ROLE_KEY;
const dbUrl = status.DB_URL;

if (!apiUrl || !serviceKey) {
  console.error('Supabase status did not report an API URL and service_role key.');
  process.exit(1);
}

// Preserve anything already configured (notably Razorpay keys); replace only ours.
const managed = {
  NEXT_PUBLIC_SUPABASE_URL: apiUrl,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  ...(dbUrl ? { SUPABASE_DB_URL: dbUrl } : {}),
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
};

const existing = exists(envPath) ? read(envPath, 'utf8').split('\n') : [];
const kept = existing.filter((line) => {
  const key = line.match(/^([A-Z_]+)=/)?.[1];
  return !key || !(key in managed);
});

const body = [
  '# Local Supabase — written by `npm run env:local`.',
  ...Object.entries(managed).map(([k, v]) => `${k}=${v}`),
  '',
  ...kept.filter((l) => !l.startsWith('# Local Supabase')),
]
  .join('\n')
  .replace(/\n{3,}/g, '\n\n');

write(envPath, `${body.trimEnd()}\n`, 'utf8');

console.log('Wrote .env.local:');
console.log(`  NEXT_PUBLIC_SUPABASE_URL  ${apiUrl}`);
console.log(`  SUPABASE_SERVICE_ROLE_KEY ${serviceKey.slice(0, 12)}…`);
if (dbUrl) console.log(`  SUPABASE_DB_URL           ${dbUrl}`);
console.log(
  process.env.RAZORPAY_KEY_ID
    ? '\nRazorpay keys detected in the environment.'
    : '\nNo Razorpay keys set — the app will run in labelled simulated mode.',
);
