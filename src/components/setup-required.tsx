import { Database } from 'lucide-react';

/**
 * Shown instead of a stack trace when Supabase env vars are missing.
 *
 * The instructions have to differ by where this is running. On a deployment
 * there is no `.env.local` to create — telling someone to make one sends them
 * looking for a file that must never exist in the repo, which is exactly the
 * confusion that leads to committing real credentials.
 */
export function SetupRequired() {
  const onVercel = Boolean(process.env.VERCEL);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-brand text-brand-foreground">
          <Database className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">PartLoop needs a database</h1>
          <p className="text-sm text-muted-foreground">
            {onVercel
              ? 'Two environment variables and one redeploy away.'
              : 'Three env vars and one SQL run away.'}
          </p>
        </div>
      </div>

      {onVercel ? <VercelSteps /> : <LocalSteps />}

      <p className="text-sm text-muted-foreground">
        Razorpay keys are optional — without them the app runs in clearly-labelled simulated mode.
      </p>
    </main>
  );
}

function VercelSteps() {
  return (
    <ol className="space-y-4 rounded-lg border bg-card p-6 text-sm">
      <li>
        <p className="font-medium">1. Add the variables in Vercel</p>
        <p className="text-muted-foreground">
          Project → <span className="font-medium">Settings → Environment Variables</span>. There is
          no <code>.env.local</code> on a deployment — that file is local-only and must never be
          committed.
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
          {'NEXT_PUBLIC_SUPABASE_URL      https://<ref>.supabase.co\nSUPABASE_SERVICE_ROLE_KEY     <service-role key>'}
        </pre>
        <p className="mt-1 text-muted-foreground">
          Tick Production, Preview and Development. Both values come from Supabase → Project
          Settings → API.
        </p>
      </li>
      <li>
        <p className="font-medium">2. Redeploy</p>
        <p className="text-muted-foreground">
          Environment variables are read at build and boot, so an existing deployment will not pick
          them up. Deployments → latest → <span className="font-medium">Redeploy</span>.
        </p>
      </li>
      <li>
        <p className="font-medium">3. Load the schema, once</p>
        <p className="text-muted-foreground">
          If the Supabase project is new, run <code>npm run db:bundle</code> locally and paste{' '}
          <code>supabase/bundle.sql</code> into the Supabase SQL editor. See{' '}
          <code>DEPLOY.md</code> in the repo.
        </p>
      </li>
    </ol>
  );
}

function LocalSteps() {
  return (
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
        <p className="mt-1 text-muted-foreground">
          <code>.env.local</code> is gitignored. Never put real values in <code>.env.example</code>{' '}
          — that one is committed.
        </p>
      </li>
      <li>
        <p className="font-medium">3. Run the schema and the seed</p>
        <p className="text-muted-foreground">
          <code>npm run db:bundle</code>, then paste <code>supabase/bundle.sql</code> into the
          Supabase SQL editor — or run <code>npm run db:push &amp;&amp; npm run db:seed</code> with{' '}
          <code>SUPABASE_DB_URL</code> set.
        </p>
      </li>
    </ol>
  );
}
