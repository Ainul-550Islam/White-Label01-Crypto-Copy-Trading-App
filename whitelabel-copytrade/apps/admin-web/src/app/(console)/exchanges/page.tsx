// # Responsibility: mounts the venue status override console.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { VenueStatusTable } from '@/features/exchanges/venue-status-table';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Venue status' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'platform:manage');

  return (
    <>
      <PageHeader
        title="Venue status"
        description="Reported venue state and any operator override in force. Overriding and clearing both need a verification, because resuming routing to a broken venue is as consequential as stopping it."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Venue overrides require platform management access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <VenueStatusTable />
      )}
    </>
  );
}
