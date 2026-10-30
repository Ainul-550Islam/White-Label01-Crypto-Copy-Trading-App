// # Responsibility: mounts reconciliation runs, findings and their recorded resolutions.
import type { JSX } from 'react';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { ReconciliationTable } from '@/features/custody/reconciliation-table';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export default async function CustodyReconciliationPage(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  const mayRead =
    hasPermission(claims, 'payout:manage') ||
    hasPermission(claims, 'platform:manage') ||
    hasPermission(claims, 'tenant:update') ||
    hasPermission(claims, 'compliance:read');
  // Running and resolving are separate permissions on the controller:
  // reconciliation:trigger and reconciliation:resolve (or platform:manage).
  const canRun = hasPermission(claims, 'reconciliation:trigger') || hasPermission(claims, 'platform:manage');
  const canResolve = hasPermission(claims, 'reconciliation:resolve') || hasPermission(claims, 'platform:manage');

  return (
    <>
      <PageHeader
        title="Custody reconciliation"
        description="Runs that compare the ledger against the chain provider, the breaks they found, and the reason recorded against each resolution. A run that could not read every row says so."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Custody requires operator access"
          message="Your session does not carry a custody oversight permission. Ask an administrator for access."
        />
      ) : (
        <ReconciliationTable canRun={canRun} canResolve={canResolve} operatorId={claims.userId} />
      )}
    </>
  );
}
