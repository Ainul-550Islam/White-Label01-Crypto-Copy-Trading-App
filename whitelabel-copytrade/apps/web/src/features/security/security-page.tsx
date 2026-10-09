'use client';
import type { JSX } from 'react';

import Link from 'next/link';
import { useAuth } from '@/auth/auth.store';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { MfaSettings } from './mfa-settings';
import { SessionsPage } from './sessions-page';
import { DevicesPage } from './devices-page';
import { ApiKeysPage } from './api-keys-page';

export function SecurityPage(): JSX.Element {
  const { session } = useAuth();

  return (
    <PageContainer
      title="Security"
      description="Security control center: multi-factor authentication, active sessions, trusted devices, and organisation API keys"
      actions={
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href="/security/mfa" className="rounded border px-3 py-1.5 hover:bg-accent">
            MFA Only
          </Link>
          <Link href="/security/sessions" className="rounded border px-3 py-1.5 hover:bg-accent">
            Sessions
          </Link>
          <Link href="/security/devices" className="rounded border px-3 py-1.5 hover:bg-accent">
            Devices
          </Link>
          <Link href="/security/api-keys" className="rounded border px-3 py-1.5 hover:bg-accent">
            API Keys
          </Link>
          <Link href="/account/profile" className="rounded bg-primary px-3 py-1.5 text-white">
            Change Password
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="rounded border bg-card p-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Account Security Posture</p>
              <p className="text-muted">
                Every privileged action requires backend verification. Rotating refresh tokens with family reuse
                detection protect your active sessions.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                status={session?.user.mfaEnabled ? '2FA ENABLED' : '2FA RECOMMENDED'}
                variant={session?.user.mfaEnabled ? 'success' : 'warning'}
              />
              <StatusBadge
                status={session?.user.emailVerified ? 'EMAIL VERIFIED' : 'EMAIL UNVERIFIED'}
                variant={session?.user.emailVerified ? 'success' : 'info'}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <MfaSettings />
          <SessionsPage />
          <DevicesPage />
          <ApiKeysPage />
        </div>
      </div>
    </PageContainer>
  );
}
