// # Responsibility: mounts the exchange user-stream list with heartbeat staleness detection.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { UserStreamTable } from '@/features/exchanges/user-stream-table';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'User data streams' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'execution:read');

  return (
    <>
      <PageHeader
        title="User data streams"
        description="Private-stream sessions per account. A stale heartbeat means order state may lag the venue, so those rows are counted and called out rather than left to be spotted."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="User streams require execution read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <UserStreamTable />
      )}
    </>
  );
}
