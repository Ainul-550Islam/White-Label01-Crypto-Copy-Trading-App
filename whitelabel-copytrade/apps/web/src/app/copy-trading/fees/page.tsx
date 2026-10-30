'use client';

import type { JSX } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { LeaderFeeScreen } from '@/features/copy-trading/leader-fee-screen';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <PageContainer title="Leader fee schedule" description="The disclosed leader profit share, its high-water-mark scope and the effective-dated history.">
          <LeaderFeeScreen />
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
