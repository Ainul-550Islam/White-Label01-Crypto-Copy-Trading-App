'use client';

import type { JSX } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { BillingInboxScreen } from '@/features/notifications/billing-inbox-screen';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <PageContainer title="Billing notifications" description="Payment, refund, invoice and dunning messages for this account, with read state.">
          <BillingInboxScreen />
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
