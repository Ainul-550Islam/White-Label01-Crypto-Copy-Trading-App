'use client';
import { PageContainer } from '@/layout/page-container';
import { MfaSettings } from './mfa-settings';
import { SessionsPage } from './sessions-page';
import { DevicesPage } from './devices-page';
import { ApiKeysPage } from './api-keys-page';
export function SecurityPage(): JSX.Element {
  return (
    <PageContainer title="Security" description="Security control center">
      <div className="grid gap-6 md:grid-cols-2">
        <MfaSettings />
        <SessionsPage />
        <DevicesPage />
        <ApiKeysPage />
      </div>
    </PageContainer>
  );
}
