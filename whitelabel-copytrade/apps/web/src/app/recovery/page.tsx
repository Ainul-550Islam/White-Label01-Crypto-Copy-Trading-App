// # Public account-recovery route: request a link, confirm it, set new credentials.
//
// This page sits OUTSIDE the auth guard on purpose - a customer who has lost access
// cannot sign in, so a guard here would lock out exactly the people the screen
// exists for. That also means it is on the route-authorization checker's public
// allow-list with a stated reason ("account recovery must work without a session"),
// and it renders inside no authenticated shell.
//
// A bearer token is accepted only in a URL fragment (`#token=...`) or by paste,
// never from a query string. Fragments are not sent in the HTTP request. The
// client entry removes a fragment from browser history as soon as it is read.
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
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-md">
        <Suspense fallback={<RecoveryFallback />}>
          <RecoveryEntry />
        </Suspense>
      </div>
    </div>
  );
}
