'use client';

import type { JSX } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { BenchmarkScreen } from '@/features/copy-trading/benchmark-screen';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <PageContainer title="Performance against a benchmark" description="A trader return compared with a benchmark, with the methodology and completeness the API reports.">
          <BenchmarkScreen />
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
