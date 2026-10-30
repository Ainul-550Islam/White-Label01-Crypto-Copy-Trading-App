// # Responsibility: mounts the copy reconciliation records, the leader fee policy editor and the portfolio valuation read.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { CopyReconciliationPanel } from '@/features/copy-trading/copy-reconciliation-panel';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Copy reconciliation' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'reconciliation:read') ||
    hasPermission(claims, 'reconciliation:resolve') ||
    hasPermission(claims, 'copy_subscription:read');

  return (
    <>
      <PageHeader
        title="Copy reconciliation"
        description="Records where a follower copy did not match the leader event, plus leader fee policy and per-asset portfolio valuation. Closing a record records a review; it never places or cancels an order."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Copy reconciliation requires reconciliation read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <CopyReconciliationPanel />
      )}
    </>
  );
}
