// # Responsibility: reads the recovery token out of the link the customer was emailed and hands it to the recovery form.
//
// This is the only place the token is taken from the URL. It lives in a file of its
// own because `useSearchParams` must sit under a Suspense boundary (see
// `app/recovery/page.tsx`); keeping the hook here means the page can stay a server
// component and still render the form fast.
//
// The token is treated as a bearer secret:
//   * it is passed down as a prop and never written to state in this component,
//   * it is never logged, never re-serialised into a URL, and never shown back,
//   * a missing token is `undefined`, not `''`, so the form starts at step one and
//     asks for a pasted link instead of failing a check the customer cannot see.
'use client';
import type { JSX } from 'react';

import { useSearchParams } from 'next/navigation';

import { AccountRecoveryPage } from './account-recovery-page';

export function RecoveryEntry(): JSX.Element {
  const searchParams = useSearchParams();
  const raw = searchParams.get('token');
  const token = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;

  return <AccountRecoveryPage initialToken={token} />;
}
