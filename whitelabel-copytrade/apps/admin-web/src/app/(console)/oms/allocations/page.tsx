// # Responsibility: mounts the copy-trading allocation list and its summary.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { OmsAllocations } from '@/features/oms/oms-allocations';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Allocations' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'trading:read') ||
    hasPermission(claims, 'trading:manage') ||
    hasPermission(claims, 'compliance:read');

  return (
    <>
      <PageHeader
        title="Allocations"
        description="How each filled master order was split across follower accounts, with the service own totals so the parts and the whole can be compared."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Allocations require trading or compliance read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <OmsAllocations />
      )}
    </>
  );
}
