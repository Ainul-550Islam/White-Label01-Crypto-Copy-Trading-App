// # Responsibility: mounts the authenticated applicant workflow inside the customer trading application shell.
'use client';

import { AuthGuard } from '@/auth/auth.guard';
import { LeadTraderApplicationPage } from '@/features/trading/lead-trader-application-page';
import { AppShell } from '@/layout/app-shell';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <LeadTraderApplicationPage />
      </AppShell>
    </AuthGuard>
  );
}
