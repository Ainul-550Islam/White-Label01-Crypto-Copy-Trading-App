'use client';

import type { JSX } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { AllocationRebalanceScreen } from '@/features/copy-trading/allocation-rebalance-screen';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <PageContainer title="Allocation rebalance" description="Preview how a target allocation would move each trader position. A preview does not place orders.">
          <AllocationRebalanceScreen />
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
