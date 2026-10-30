// # Responsibility: mounts the OMS order search over every intent with its state, fills and reconciliation columns.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { OmsOrdersView } from '@/features/oms/oms-orders-view';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Order management' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'trading:manage') ||
    hasPermission(claims, 'trading:read') ||
    hasPermission(claims, 'compliance:read');

  return (
    <>
      <PageHeader
        title="Order management"
        description="Every order intent the OMS has recorded, with its venue state, fills and reconciliation status. Cancel and replace carry a reason; nothing here edits an order state directly."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Order management requires trading or compliance read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <OmsOrdersView />
      )}
    </>
  );
}
