// # NEW — Admin console route for compliance cases and KYC/AML queue
import type { JSX } from 'react';
import type { Metadata } from 'next';
import { Card, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';
import {
  ComplianceCaseQueue,
  type ComplianceCaseQueueItem,
} from '@/features/compliance/compliance-case-queue';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Compliance & AML Case Queue' };

export default async function ComplianceQueuePage(): Promise<JSX.Element> {
  const failures: string[] = [];
  const track = async <T,>(label: string, promise: Promise<T>): Promise<T | null> => {
    try {
      return await promise;
    } catch (err) {
      failures.push(`${label}: ${(err as Error).message}`);
      return null;
    }
  };

  // Both endpoints answer with the platform's paged envelope - `{ data, total, page, limit }` from
  // `complianceCase.repository.listTenantCases` and `transactionMonitoringService.listSignals`.
  // This page asked for `items` and `cases`, neither of which those services return, so the queue
  // rendered empty against the real API while the console reported no failure at all: a silent
  // empty page is indistinguishable from a tenant with no cases, which is the worst way for a
  // compliance screen to be wrong.
  const [casesRes, signalsRes] = await Promise.all([
    track(
      'compliance cases',
      serverFetch<{ data?: ComplianceCaseQueueItem[]; total?: number }>('/compliance/cases', {
        searchParams: { limit: 50 },
      }),
    ),
    track(
      'monitoring signals',
      serverFetch<{ data?: unknown[]; total?: number }>('/compliance/monitoring/signals', {
        searchParams: { limit: 25 },
      }),
    ),
  ]);

  const cases = casesRes?.data ?? [];
  const openCases = cases.filter((c) => c.state !== 'RESOLVED' && c.state !== 'CLOSED');
  const escalatedCases = openCases.filter(
    (c) => c.state === 'ESCALATED' || c.riskLevel === 'CRITICAL' || c.riskLevel === 'HIGH',
  );

  return (
    <>
      <PageHeader
        title="Compliance, KYC/AML & Transaction Monitoring Queue"
        description="Review KYC/AML screening hits, transaction monitoring alerts, EDD requests, and compliance holds."
      />

      {failures.length > 0 && (
        <div style={{ marginTop: theme.space(4) }}>
          <ErrorNotice title="Compliance data partially degraded" message={failures.join(' · ')} />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: theme.space(4),
          marginTop: theme.space(5),
        }}
      >
        <StatTile
          label="Open Cases"
          value={openCases.length}
          hint={`${cases.length} total cases in queue`}
        />
        <StatTile
          label="High / Escalated"
          value={escalatedCases.length}
          hint="Priority MLRO review required"
        />
        <StatTile
          label="Monitoring Signals"
          value={signalsRes?.total ?? signalsRes?.data?.length ?? 0}
          hint="Velocity, structuring & jurisdiction alerts"
        />
      </div>

      <div style={{ marginTop: theme.space(6) }}>
        <Card
          title="Compliance Case Queue"
          description="Filter cases by workflow state, severity, and SLA. Click a case ID to inspect evidence, AML hits, and record a decision."
        >
          <ComplianceCaseQueue cases={cases} />
        </Card>
      </div>
    </>
  );
}
