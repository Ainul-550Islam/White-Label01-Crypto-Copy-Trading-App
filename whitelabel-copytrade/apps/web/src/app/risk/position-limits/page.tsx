// # Responsibility: authenticated customer page for per-user concurrent position and open-order limits.

'use client';
import type { JSX } from 'react';

import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { PositionLimitSettings } from '@/features/trading/position-limit-settings';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <PageContainer
          title="Position and Order Limits"
          description="Set optional user-wide count ceilings for new platform OMS submissions and inspect their canonical usage."
        >
          <PositionLimitSettings />
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
