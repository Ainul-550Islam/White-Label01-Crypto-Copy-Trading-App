// # Responsibility: mounts the exchange health table, the per-account checks and syncs, the routing decision and the venue registry.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { ExchangeOperationsPanel } from '@/features/exchanges/exchange-operations-panel';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Exchange operations' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'exchange_account:read') ||
    hasPermission(claims, 'trading:read') ||
    hasPermission(claims, 'trading:manage');

  return (
    <>
      <PageHeader
        title="Exchange operations"
        description="Health, connectivity, capability discovery, the three sync commands and the routing decision. Unmeasured telemetry is labelled as unmeasured rather than reported as zero."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Exchange operations require exchange account or trading read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <ExchangeOperationsPanel />
      )}
    </>
  );
}
