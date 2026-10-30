// # Responsibility: mounts one account's risk posture, liquidation distance, daily P&L and its limit history.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { AccountRiskPanel } from '@/features/risk/account-risk-panel';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Account risk' };

export default async function Page({ params }: { params: Promise<{ accountId: string }> }): Promise<JSX.Element> {
  const { accountId } = await params;
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'risk:read') ||
    hasPermission(claims, 'risk:config:update') ||
    hasPermission(claims, 'portfolio:read');

  return (
    <>
      <PageHeader
        title="Account risk"
        description="Margin, leverage, liquidation distance and the enforced limit version for one account. A limits save carries the version it was based on; a rollback needs the typed phrase the API requires."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Account risk requires risk read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <AccountRiskPanel accountId={accountId} />
      )}
    </>
  );
}
