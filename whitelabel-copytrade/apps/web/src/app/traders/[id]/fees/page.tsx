// # Responsibility: authenticated customer route for viewing a lead trader's active fee disclosure.
'use client';
import type { JSX } from 'react';
import { use } from 'react';

import { AuthGuard } from '@/auth/auth.guard';
import { LeaderFeeSettingsPage } from '@/features/trading/leader-fee-settings-page';
import { AppShell } from '@/layout/app-shell';

export default function Page({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  return (
    <AuthGuard>
      <AppShell>
        <LeaderFeeSettingsPage traderId={id} />
      </AppShell>
    </AuthGuard>
  );
}
