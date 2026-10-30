// # Responsibility: mounts the liquidation alert list with its severity filter.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { LiquidationAlertTable } from '@/features/risk/liquidation-alert-table';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Liquidation alerts' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'risk:read') ||
    hasPermission(claims, 'portfolio:read');

  return (
    <>
      <PageHeader
        title="Liquidation alerts"
        description="Positions inside the risk service warning band, with the distance to liquidation it reports. An unknown distance is shown as unknown rather than as a comfortable number."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Liquidation alerts require risk or portfolio read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <LiquidationAlertTable />
      )}
    </>
  );
}
