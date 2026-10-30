// # Responsibility: mounts the exchange account console with connectivity, balances and the live-trading ceremony.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { ExchangeAccountTable } from '@/features/execution/exchange-account-table';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Exchange accounts' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'exchange_account:read') ||
    hasPermission(claims, 'trading:manage');

  return (
    <>
      <PageHeader
        title="Exchange accounts"
        description="Connectivity, balances, streams and the enabled, private-stream and live-trading switches. Enabling live trading needs the typed confirmation phrase; no API key or secret is ever shown here."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Exchange accounts require exchange account read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <ExchangeAccountTable />
      )}
    </>
  );
}
