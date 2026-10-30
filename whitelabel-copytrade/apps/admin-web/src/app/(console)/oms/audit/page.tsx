// # Responsibility: mounts the OMS audit history with redaction of credential-shaped detail fields.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { OmsAuditLog } from '@/features/oms/oms-audit-log';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Order audit trail' };

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
        title="Order audit trail"
        description="Immutable OMS events with actor and detail. Values that look like credentials are redacted rather than echoed into the console."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="The audit trail requires trading or compliance read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <OmsAuditLog />
      )}
    </>
  );
}
