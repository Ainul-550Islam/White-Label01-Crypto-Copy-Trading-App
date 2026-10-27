'use client';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { AccountRecoveryPage } from './account-recovery-page';

/** A recovery bearer is accepted only from a URL fragment, never a query. */
export function RecoveryEntry(): JSX.Element {
  const [token, setToken] = useState<string | undefined>();
  useEffect(() => {
    const consumeFragment = () => {
      const url = new URL(window.location.href);
      const value = new URLSearchParams(url.hash.slice(1)).get('token');
      // Remove both fragments and any legacy query token from browser history.
      // A legacy query may already have reached server logs and is not consumed.
      if (url.hash || url.searchParams.has('token')) {
        url.hash = '';
        url.searchParams.delete('token');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
      }
      if (value && /^[A-Za-z0-9_-]{16,256}$/.test(value)) setToken(value);
    };
    consumeFragment();
    // Opening a mail link in a tab already on /recovery may only change the
    // fragment and therefore does not remount this component.
    window.addEventListener('hashchange', consumeFragment);
    return () => window.removeEventListener('hashchange', consumeFragment);
  }, []);
  return <AccountRecoveryPage key={token ?? 'request'} initialToken={token} />;
}
