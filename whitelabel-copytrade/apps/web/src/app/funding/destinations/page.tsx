'use client';

import type { JSX } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { DestinationsScreen } from '@/features/funding/destinations-screen';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <PageContainer title="Withdrawal destinations" description="Addresses that may receive withdrawals, their verification state, and how to revoke one.">
          <DestinationsScreen />
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
