// # Responsibility: mounts the execution order list with its filter set and reasoned cancel.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { ExecutionOrderTable } from '@/features/execution/execution-order-table';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Execution orders' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'order:read') ||
    hasPermission(claims, 'trading:read') ||
    hasPermission(claims, 'trading:manage');

  return (
    <>
      <PageHeader
        title="Execution orders"
        description="Orders handed to the execution service, with unreconciled ones called out first. Cancelling requires a reason and is confirmed against the returned state rather than assumed."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Execution orders require order or trading read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <ExecutionOrderTable />
      )}
    </>
  );
}
