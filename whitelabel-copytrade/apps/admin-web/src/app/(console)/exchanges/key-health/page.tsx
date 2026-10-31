// # Responsibility: mounts the read-only exchange-key capability health table.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { ExchangeKeyHealthConsole } from '@/features/exchanges/exchange-key-health-console';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Exchange key health' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: `GET admin/exchanges/key-health` requires
  // exchange_account:read, and the API re-authorises the request itself.
  const mayRead = hasPermission(claims, 'exchange_account:read');

  return (
    <>
      <PageHeader
        title="Exchange key health"
        description="Whether each key can read, trade and withdraw, and what a human must do about it. Read-only: rotating or revoking a key is done on the exchange-account screen, where the verification and audit trail live."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Key health requires exchange-account read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <ExchangeKeyHealthConsole />
      )}
    </>
  );
}
