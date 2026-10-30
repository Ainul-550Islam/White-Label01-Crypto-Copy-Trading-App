// # Responsibility: mounts the custody transaction list with monitoring detail, filters and pagination.
import type { JSX } from 'react';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { CustodyTransactionTable } from '@/features/custody/custody-transaction-table';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export default async function CustodyTransactionsPage(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  const mayRead =
    hasPermission(claims, 'payout:manage') ||
    hasPermission(claims, 'platform:manage') ||
    hasPermission(claims, 'tenant:update') ||
    hasPermission(claims, 'compliance:read');
  // `POST custody/transactions/:id/poll` is platform-only on the controller, so
  // the refresh control is only offered to a platform principal. The API still
  // refuses the call for anyone else.
  const mayPoll = Boolean(claims?.isPlatformUser) && hasPermission(claims, 'platform:manage');

  return (
    <>
      <PageHeader
        title="Custody transactions"
        description="Every recorded movement with its observation state, confirmation progress and the fee actually charged. Filtering and paging happen on the API, so a filtered view is never a partial local copy."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Custody requires operator access"
          message="Your session does not carry a custody oversight permission. Ask an administrator for access."
        />
      ) : (
        <CustodyTransactionTable canPoll={mayPoll} />
      )}
    </>
  );
}
