// # Responsibility: mounts the operator own billing inbox and notification preferences.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { BillingInboxPanel } from '@/features/billing/billing-inbox-panel';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Billing inbox' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'subscription:read') ||
    hasPermission(claims, 'invoice:read') ||
    hasPermission(claims, 'tenant:update');

  return (
    <>
      <PageHeader
        title="Billing inbox"
        description="Your own billing messages and channel preferences. The API scopes both to your session, so this screen cannot read another person’s inbox."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="The billing inbox requires an authenticated session"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <BillingInboxPanel />
      )}
    </>
  );
}
