// # Responsibility: mounts the revenue analytics dashboard for an explicit period.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { BillingAnalyticsDashboard } from '@/features/billing/billing-analytics-dashboard';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Billing analytics' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead =
    hasPermission(claims, 'subscription:read') ||
    hasPermission(claims, 'invoice:read');

  return (
    <>
      <PageHeader
        title="Billing analytics"
        description="Revenue, recurring revenue, churn, cashflow, cohorts and the service own financial report. A figure the service could not compute is shown as unavailable, never as zero."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Billing analytics require subscription read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <BillingAnalyticsDashboard />
      )}
    </>
  );
}
