// # Responsibility: serves the tenant-scoped lead-trader review queue in the authenticated admin console.
import type { JSX } from 'react';
import type { Metadata } from 'next';
import { Card, ErrorNotice, PageHeader } from '@/components/ui';
import { LeadTraderApplicationQueue, type AdminLeadTraderApplication } from '@/features/trading/lead-trader-application-queue';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Lead Trader Applications' };

interface LeadTraderApplicationQueueResponse {
  data: AdminLeadTraderApplication[];
  total: number;
  page: number;
  limit: number;
}

export default async function LeadTraderApplicationsPage(): Promise<JSX.Element> {
  let queue: LeadTraderApplicationQueueResponse = { data: [], total: 0, page: 1, limit: 50 };
  let errorMessage: string | null = null;
  try {
    queue = await serverFetch<LeadTraderApplicationQueueResponse>('/copy-trading/lead-trader-applications/admin', {
      searchParams: { page: 1, limit: 50 },
    });
  } catch (error) {
    errorMessage = (error as Error).message || 'Could not load lead-trader applications.';
  }

  return (
    <>
      <PageHeader
        title="Lead Trader Applications"
        description="Review tenant-scoped qualification declarations. Approval is separate from trader performance verification and live-execution authorization."
      />
      {errorMessage && (
        <div style={{ marginTop: theme.space(4) }}>
          <ErrorNotice title="Application queue unavailable" message={errorMessage} />
        </div>
      )}
      <div style={{ marginTop: theme.space(5) }}>
        <Card title="Qualification review queue" description="Claim an application before deciding it. Rejections require a reason and preserve the submitted version.">
          <LeadTraderApplicationQueue initialQueue={queue} />
        </Card>
      </div>
    </>
  );
}
