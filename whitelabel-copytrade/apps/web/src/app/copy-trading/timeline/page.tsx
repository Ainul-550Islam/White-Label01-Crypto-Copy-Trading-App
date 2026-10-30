'use client';

import type { JSX } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { ExecutionTimelineScreen } from '@/features/copy-trading/execution-timeline-screen';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <PageContainer title="Copy execution timeline" description="Every recorded event for one copy execution, including retries and the reason each attempt failed.">
          <ExecutionTimelineScreen />
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
