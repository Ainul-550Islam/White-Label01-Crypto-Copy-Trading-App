// # Responsibility: mounts the billing analytics sections - revenue, cohorts, cashflow, recognition and plan performance - for one explicit period.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { CashflowPanel } from '@/features/billing-analytics/cashflow-panel';
import { CohortRetentionGrid } from '@/features/billing-analytics/cohort-retention-grid';
import { PlanPerformanceTable } from '@/features/billing-analytics/plan-performance-table';
import { RecognitionPanel } from '@/features/billing-analytics/recognition-panel';
import { RevenueKpis } from '@/features/billing-analytics/revenue-kpis';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Billing analytics' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead = hasPermission(claims, 'subscription:read') ||
    hasPermission(claims, 'invoice:read');;

  return (
    <>
      <PageHeader
        title="Billing analytics"
        description="Recurring revenue, customer cohorts, cashflow, revenue recognition and plan performance, each with the provenance the service returned. A metric the service could not compute is shown as unavailable."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Billing analytics require subscription read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <div className="grid gap-4">
          <RevenueKpis query={{}} />
          <CohortRetentionGrid query={{}} />
          <CashflowPanel query={{}} />
          <RecognitionPanel query={{}} />
          <PlanPerformanceTable query={{}} />
          <p className="text-sm">
            <a className="underline" href="/billing/analytics/reports">Open the financial report and cache controls</a>
          </p>
        </div>
      )}
    </>
  );
}
