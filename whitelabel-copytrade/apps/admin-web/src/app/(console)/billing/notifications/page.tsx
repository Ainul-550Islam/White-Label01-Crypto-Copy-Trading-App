// # Responsibility: mounts the billing notification history, webhook lifecycle, worker and reconciliation.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { BillingNotificationsPanel } from '@/features/billing/billing-notifications-panel';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Billing notifications' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'tenant:update') ||
    hasPermission(claims, 'subscription:read') ||
    hasPermission(claims, 'invoice:read');

  return (
    <>
      <PageHeader
        title="Billing notifications"
        description="Delivery history, webhook endpoints and their one-time secrets, the send worker and reconciliation. A secret is displayed once and cannot be read back, so the page says so plainly."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Billing notifications require tenant update access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <BillingNotificationsPanel />
      )}
    </>
  );
}
