import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SignOutButton } from '@/components/sign-out-button';
import { Sidebar } from '@/components/sidebar';
import { publicEnv } from '@/lib/env';
import { decodeAccessTokenClaims, getAccessToken } from '@/lib/session';
import { theme } from '@/lib/theme';

export const dynamic = 'force-dynamic';

/**
 * Authenticated shell.
 *
 * The claims decoded here drive navigation only. Every page fetches its own
 * data through the API, which re-authorises the request; a forged cookie buys
 * an attacker a rendered sidebar and nothing else.
 */
export default function ConsoleLayout({ children }: { children: ReactNode }): JSX.Element {
  const token = getAccessToken();

  if (!token) {
    redirect('/login');
  }

  const claims = decodeAccessTokenClaims(token);

  if (!claims) {
    redirect('/login');
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '248px 1fr' }}>
      <aside
        style={{
          borderRight: `1px solid ${theme.color.border}`,
          background: theme.color.surface,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: theme.space(5), borderBottom: `1px solid ${theme.color.border}` }}>
          <Link href="/dashboard" style={{ color: theme.color.text, textDecoration: 'none' }}>
            <strong style={{ fontSize: 15 }}>{publicEnv.appName}</strong>
          </Link>
          <div style={{ color: theme.color.textMuted, fontSize: 12, marginTop: 4 }}>
            {claims.plat ? 'Platform operator' : 'Organisation admin'}
          </div>
        </div>

        <Sidebar permissions={claims.perms} isPlatformUser={claims.plat} />

        <div
          style={{
            marginTop: 'auto',
            padding: theme.space(4),
            borderTop: `1px solid ${theme.color.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: theme.space(3),
          }}
        >
          <div style={{ fontSize: 12, color: theme.color.textMuted, wordBreak: 'break-all' }}>
            Roles: {claims.roles.length > 0 ? claims.roles.join(', ') : '—'}
          </div>
          <SignOutButton />
        </div>
      </aside>

      <main style={{ padding: theme.space(8), maxWidth: 1280 }}>{children}</main>
    </div>
  );
}
