'use client';

import type { JSX } from 'react';
import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { EventPreferencesScreen } from '@/features/notifications/event-preferences-screen';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <PageContainer title="Billing notification preferences" description="Choose which channels deliver each billing event, and save every change in one request.">
          <EventPreferencesScreen />
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
