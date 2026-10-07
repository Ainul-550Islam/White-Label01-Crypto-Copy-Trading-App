// # Responsibility: authenticated customer route for viewing a lead trader's active fee disclosure.
'use client';

import { AuthGuard } from '@/auth/auth.guard';
import { LeaderFeeSettingsPage } from '@/features/trading/leader-fee-settings-page';
import { AppShell } from '@/layout/app-shell';

export default function Page({ params }: { params: { id: string } }): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <LeaderFeeSettingsPage traderId={params.id} />
      </AppShell>
    </AuthGuard>
  );
}
