// # Responsibility: mounts the venue status board and the user-stream health panel for one account at a time.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { UserStreamHealth } from '@/features/exchanges/user-stream-health';
import { VenueStatusGrid } from '@/features/exchanges/venue-status-grid';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Exchanges and streams' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead = hasPermission(claims, 'execution:read') ||
    hasPermission(claims, 'exchange_account:read') ||
    hasPermission(claims, 'platform:manage');;

  return (
    <>
      <PageHeader
        title="Exchanges and streams"
        description="What each venue reports and where that report came from, plus the engine view of the user-data streams our accounts depend on. Silence from the engine is shown as silence."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Venue status requires execution or exchange-account read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <div className="grid gap-4">
          <VenueStatusGrid />
          <UserStreamHealth />
        </div>
      )}
    </>
  );
}
