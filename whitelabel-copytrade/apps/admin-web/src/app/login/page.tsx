import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/login-form';
import { publicEnv } from '@/lib/env';
import { getAccessToken } from '@/lib/session';
import { theme } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage(): JSX.Element {
  if (getAccessToken()) {
    redirect('/dashboard');
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: theme.space(6),
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: theme.color.surface,
          border: `1px solid ${theme.color.border}`,
          borderRadius: theme.radius.lg,
          padding: theme.space(8),
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>{publicEnv.appName}</h1>
        <p style={{ color: theme.color.textMuted, fontSize: 14, marginTop: theme.space(2) }}>
          Sign in with your operator account.
        </p>

        <div style={{ marginTop: theme.space(6) }}>
          <LoginForm />
        </div>

        <p style={{ color: theme.color.textMuted, fontSize: 12, marginTop: theme.space(6) }}>
          Access is logged. Repeated failed attempts temporarily lock the account.
        </p>
      </div>
    </main>
  );
}
