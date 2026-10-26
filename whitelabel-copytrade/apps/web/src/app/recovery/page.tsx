// # Public account-recovery route: request a link, confirm it, set new credentials.
//
// This page sits OUTSIDE the auth guard on purpose - a customer who has lost access
// cannot sign in, so a guard here would lock out exactly the people the screen
// exists for. That also means it is on the route-authorization checker's public
// allow-list with a stated reason ("account recovery must work without a session"),
// and it renders inside no authenticated shell.
//
// The token can arrive two ways: in the link (`?token=…`) or pasted by hand. Both
// are accepted because recovery mail is often opened on a different device from the
// one being recovered. The token is read from the query string, never logged, and
// handed straight to the API.
//
// WHY THIS FILE IS A SERVER COMPONENT AND THE FORM IS NOT
// ------------------------------------------------------
// Reading `?token=` requires `useSearchParams`, which Next only allows inside a
// Suspense boundary: a page that calls it while being prerendered aborts the build
// with "useSearchParams() should be wrapped in a suspense boundary". Exporting
// `dynamic = 'force-dynamic'` is not available here either - route segment config is
// ignored in a `use client` module. So the route stays a server component that owns
// the layout and the Suspense boundary, and the hook lives one file down, in
// `RecoveryEntry`. The fallback is deliberately the outline of the real form rather
// than a spinner: this screen is reached from an email link by someone who has just
// lost access, and a blank flash reads as a broken link.
import type { JSX } from 'react';

import { Suspense } from 'react';

import { RecoveryEntry } from '@/features/security/recovery-entry';

function RecoveryFallback(): JSX.Element {
  return (
    <div className="grid gap-4 rounded border bg-card p-6" aria-busy="true">
      <div className="h-5 w-2/3 rounded bg-slate-200" />
      <div className="h-3 w-full rounded bg-slate-100" />
      <div className="h-3 w-5/6 rounded bg-slate-100" />
      <div className="h-10 w-full rounded bg-slate-100" />
      <p className="text-xs text-muted">Opening the recovery form…</p>
    </div>
  );
}

export default function RecoveryRoute(): JSX.Element {
  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-md">
        <Suspense fallback={<RecoveryFallback />}>
          <RecoveryEntry />
        </Suspense>
      </div>
    </main>
  );
}
