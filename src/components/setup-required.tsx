import { Database } from 'lucide-react';

/** Shown instead of a stack trace when Supabase env vars are missing. */
export function SetupRequired() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-brand text-brand-foreground">
          <Database className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">PartLoop needs a database</h1>
          <p className="text-sm text-muted-foreground">Three env vars and one SQL run away.</p>
        </div>
      </div>

      <ol className="space-y-4 rounded-lg border bg-card p-6 text-sm">
        <li>
          <p className="font-medium">1. Create a Supabase project</p>
          <p className="text-muted-foreground">
            Then copy the project URL and the <code>service_role</code> key from Project Settings →
            API.
          </p>
        </li>
        <li>
          <p className="font-medium">
            2. Put them in <code>.env.local</code>
          </p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {'NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=<service-role-key>'}
          </pre>
        </li>
        <li>
          <p className="font-medium">3. Run the schema and the seed</p>
          <p className="text-muted-foreground">
            Paste every file in <code>supabase/migrations/</code> (in order), then{' '}
            <code>supabase/seed.sql</code>, into the Supabase SQL editor — or run{' '}
            <code>npm run db:push &amp;&amp; npm run db:seed</code> with{' '}
            <code>SUPABASE_DB_URL</code> set.
          </p>
        </li>
      </ol>

      <p className="text-sm text-muted-foreground">
        Razorpay keys are optional — without them the app runs in clearly-labelled simulated mode.
      </p>
    </main>
  );
}
