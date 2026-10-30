'use client';

import type { JSX } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { StreamStatusScreen } from '@/features/exchanges/stream-status-screen';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <PageContainer title="Stream and venue status" description="The engine view of your exchange user-data streams, and the status board each venue reports.">
          <StreamStatusScreen />
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
