'use client';

import type { JSX } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { AccountingOverview } from '@/features/portfolio/accounting-overview';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <PageContainer title="Portfolio accounting" description="Lots, realised and unrealised profit and loss, cost basis, periods and statements, as the accounting service publishes them.">
          <AccountingOverview />
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
