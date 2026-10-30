// # Responsibility: mounts the reconciliation queue with its acknowledgement form and the per-account reconciliation run.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { OmsReconciliationQueue } from '@/features/oms/oms-reconciliation-queue';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Reconciliation' };

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
        title="Reconciliation"
        description="Where the platform and the venue disagree. A finding is acknowledged with a written resolution; it is never silently marked matched."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Reconciliation requires trading or compliance read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <OmsReconciliationQueue />
      )}
    </>
  );
}
