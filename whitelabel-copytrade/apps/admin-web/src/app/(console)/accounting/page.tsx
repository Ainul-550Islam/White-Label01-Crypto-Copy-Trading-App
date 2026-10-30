// # Responsibility: mounts the accounting ledger console with snapshots, periods, adjustments and reconciliations.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { PortfolioLedgerConsole } from '@/features/portfolio/portfolio-ledger-console';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Portfolio accounting' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'payout:manage') ||
    hasPermission(claims, 'reconciliation:trigger') ||
    hasPermission(claims, 'compliance:read');

  return (
    <>
      <PageHeader
        title="Portfolio accounting"
        description="Ledger profiles, cash and positions, dated snapshots, accounting periods, adjustments and reconciliations. A period close is final and an adjustment always carries a written reason."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Portfolio accounting requires finance or reconciliation access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <PortfolioLedgerConsole />
      )}
    </>
  );
}
