// # Responsibility: mounts the stale and rejected order consoles with retry, recovery, acknowledgement and notes.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { OmsOperations } from '@/features/oms/oms-operations';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Operational exceptions' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'trading:manage') ||
    hasPermission(claims, 'trading:read') ||
    hasPermission(claims, 'compliance:read');

  return (
    <>
      <PageHeader
        title="Operational exceptions"
        description="Stale and rejected orders per account, with retry, recovery, acknowledgement and operator notes. Retrying into an unhealthy venue is an operator decision, so it is never automatic."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Operational exceptions require trading or compliance read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <OmsOperations />
      )}
    </>
  );
}
