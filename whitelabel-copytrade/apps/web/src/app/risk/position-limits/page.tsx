// # Responsibility: authenticated customer page for per-user concurrent position and open-order limits.

'use client';
import type { JSX } from 'react';

import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { PositionLimitSettings } from '@/features/trading/position-limit-settings';
import { AccountOrderLimitSettings } from '@/features/trading/account-order-limit-settings';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <PageContainer><div className="space-y-8"><PositionLimitSettings /><AccountOrderLimitSettings /></div></PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
