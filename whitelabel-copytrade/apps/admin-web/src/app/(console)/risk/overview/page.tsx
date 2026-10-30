// # Responsibility: mounts the risk dashboard for the whole organisation or for one account.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { RiskOverview } from '@/features/risk/risk-overview';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Risk overview' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead = hasPermission(claims, 'risk:read') ||
    hasPermission(claims, 'portfolio:read');;

  return (
    <>
      <PageHeader
        title="Risk overview"
        description="Exposure, drawdown and daily loss as the risk service computes them, with the account scope that produced them. A figure the service could not compute is shown as unavailable, never as zero."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Risk overview requires risk read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <div className="grid gap-4">
          <RiskOverview accountId="" />
        </div>
      )}
    </>
  );
}
