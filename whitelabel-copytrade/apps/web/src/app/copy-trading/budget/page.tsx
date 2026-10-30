'use client';

import type { JSX } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { CopyBudgetScreen } from '@/features/copy-trading/copy-budget-screen';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <PageContainer title="Copy-trading budget" description="The most quote-asset capital you allow in active copies, what is committed against it, and how to reduce it.">
          <CopyBudgetScreen />
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
