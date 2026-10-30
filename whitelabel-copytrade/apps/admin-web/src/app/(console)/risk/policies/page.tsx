// # Responsibility: mounts the risk policy editor and its version history.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { RiskPolicyPanel } from '@/features/risk/risk-policy-panel';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Risk policy' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'risk:read') ||
    hasPermission(claims, 'risk:config:update');

  return (
    <>
      <PageHeader
        title="Risk policy"
        description="Institutional thresholds per scope. A save carries the version it was based on, so a concurrent change is reported rather than overwritten, and it needs a verification."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Risk policy requires risk read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <RiskPolicyPanel />
      )}
    </>
  );
}
