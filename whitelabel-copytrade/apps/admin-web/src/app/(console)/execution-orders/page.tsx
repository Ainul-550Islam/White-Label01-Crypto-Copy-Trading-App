// # Responsibility: mounts the execution order view and the exchange-account operator actions.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { ExchangeAccountOps } from '@/features/execution/exchange-account-ops';
import { ExecutionOrderTable } from '@/features/execution/execution-order-table';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Execution orders and exchange accounts' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead = hasPermission(claims, 'order:read') ||
    hasPermission(claims, 'exchange_account:read') ||
    hasPermission(claims, 'execution:read');;

  return (
    <>
      <PageHeader
        title="Execution orders and exchange accounts"
        description="Orders as the execution service recorded them, and the per-account operator view: connectivity, balances, live-trading state and an out-of-band reconciliation."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Execution orders require order read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <div className="grid gap-4">
          <ExecutionOrderTable />
          <ExchangeAccountOps />
        </div>
      )}
    </>
  );
}
