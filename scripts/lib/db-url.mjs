/**
 * Validation for SUPABASE_DB_URL, shared by db.mjs and inspect-db.mjs.
 *
 * Every check here exists because the failure it prevents is otherwise silent
 * or cryptic: pasting the REST URL surfaces as `ETIMEDOUT` against a Cloudflare
 * address, and leaving the `[YOUR-PASSWORD]` placeholder in surfaces as a
 * password authentication failure that looks like a wrong password.
 */

const DASHBOARD_HINT =
  'Supabase dashboard -> your project -> Connect (top of the page) -> Session pooler,\n' +
  'or Project Settings -> Database -> Connection string.';

const BUNDLE_HINT =
  'No connection string to hand? Run `npm run db:bundle` and paste supabase/bundle.sql\n' +
  'into the SQL editor instead — that needs no password at all.';

/** Masks the password so a connection string can be printed in an error. */
export function maskDbUrl(url) {
  return url.replace(/:[^:@/]*@/, ':****@');
}

/**
 * Exits the process with an explanation if the connection string is missing or
 * obviously not a Postgres URI. Returns the string when it looks usable.
 */
export function requireDbUrl(connectionString) {
  if (!connectionString) {
    console.error(`SUPABASE_DB_URL is not set in .env.local.\n\n${BUNDLE_HINT}`);
    process.exit(1);
  }

  if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
    console.error(
      'SUPABASE_DB_URL does not look like a Postgres connection string:\n' +
        `  ${maskDbUrl(connectionString)}\n\n` +
        'It must start with postgresql:// — this is NOT the REST API URL, which\n' +
        'is the one that goes in NEXT_PUBLIC_SUPABASE_URL.\n' +
        `${DASHBOARD_HINT}\n\n${BUNDLE_HINT}`,
    );
    process.exit(1);
  }

  // The dashboard hands you the URI with the password as a literal placeholder.
  if (/\[YOUR-PASSWORD\]|\[your-password\]|:PASSWORD@/.test(connectionString)) {
    console.error(
      'SUPABASE_DB_URL still contains the password placeholder from the dashboard.\n' +
        'Replace it with your actual database password (Project Settings -> Database ->\n' +
        'Database password, where you can also reset it — note that resetting breaks any\n' +
        'other app already using the old one).\n\n' +
        'If the password contains @ : / # or ?, percent-encode it: @ becomes %40,\n' +
        '# becomes %23, / becomes %2F, : becomes %3A, ? becomes %3F.',
    );
    process.exit(1);
  }

  return connectionString;
}

/** Supabase cloud needs TLS; the local `supabase start` container refuses it. */
export function sslFor(connectionString) {
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);
  return isLocal ? false : { rejectUnauthorized: false };
}
