// # Responsibility: mounts the reconciliation runs, the discrepancy review and the execution kill switches.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { ExecutionReconciliationPanel } from '@/features/execution/execution-reconciliation-panel';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Execution reconciliation' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'reconciliation:read') ||
    hasPermission(claims, 'reconciliation:resolve') ||
    hasPermission(claims, 'trading:manage') ||
    hasPermission(claims, 'kill_switch:read');

  return (
    <>
      <PageHeader
        title="Execution reconciliation"
        description="Runs, discrepancies and kill switches. A gap in the run list is itself a signal that reconciliation stopped, so the newest run is shown first."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Execution reconciliation requires reconciliation read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <ExecutionReconciliationPanel />
      )}
    </>
  );
}
