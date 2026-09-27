'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { theme } from '@/lib/theme';

function readCsrfCookie(): string {
  const match = document.cookie.match(/(?:^|;\s*)wlct_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export function SignOutButton(): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut(): Promise<void> {
    setBusy(true);

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'x-csrf-token': readCsrfCookie() },
        credentials: 'same-origin',
      });
    } finally {
      // Navigate regardless: the cookies are cleared server-side either way.
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      style={{
        background: 'transparent',
        border: `1px solid ${theme.color.border}`,
        color: theme.color.textMuted,
        borderRadius: theme.radius.sm,
        padding: '6px 12px',
        fontSize: 13,
        cursor: busy ? 'not-allowed' : 'pointer',
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
