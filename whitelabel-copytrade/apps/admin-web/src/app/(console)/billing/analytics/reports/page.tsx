// # Responsibility: mounts the financial report with the analytics cache-invalidate control.
import type { JSX } from 'react';
import type { Metadata } from 'next';

import { ErrorNotice, PageHeader } from '@/components/ui';
import { FinancialReportPanel } from '@/features/billing-analytics/financial-report-panel';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Financial reports' };

export default async function Page(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  // Usability gate only: the API re-authorises every request this page makes.
  const mayRead = hasPermission(claims, 'subscription:read') ||
    hasPermission(claims, 'invoice:read');;

  return (
    <>
      <PageHeader
        title="Financial reports"
        description="The service own financial report for a closed period, rendered exactly as published, with the cache-invalidate control that recomputes the figures on the next read."
      />
      {!mayRead || !claims ? (
        <ErrorNotice
          title="Financial reports require subscription read access"
          message="Your session does not carry a permission this screen requires. Ask an administrator for access."
        />
      ) : (
        <div className="grid gap-4">
          <FinancialReportPanel query={{}} />
        </div>
      )}
    </>
  );
}
