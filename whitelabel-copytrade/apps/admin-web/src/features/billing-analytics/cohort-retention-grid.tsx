'use client';

import type { JSX } from 'react';

import { billingAnalyticsApi, type CohortRow, type RevenueQuery } from '@/api/billing-analytics-api';
import { Card, DataTable, EmptyState, ErrorNotice } from '@/components/ui';
import { useResource } from '@/features/shared/use-resource';

/**
 * Cohort retention.
 *
 * Each cell carries the rate the service computed and the size of the cohort it was computed from. A
 * cohort with three customers and a cohort with three thousand look identical if only the percentage is
 * printed, which is exactly the mistake this grid avoids.
 */
export function CohortRetentionGrid({ query, retentionPeriods = 6 }: { query: RevenueQuery; retentionPeriods?: number }): JSX.Element {
  const cohorts = useResource(() => billingAnalyticsApi.getCohorts({ ...query, retentionPeriods }), [query, retentionPeriods], {
    errorMessage: 'Cohorts could not be loaded.',
  });

  return (
    <Card title="Cohort retention">
      {cohorts.error ? (
        <ErrorNotice title="Cohort retention" message={cohorts.error} />
      ) : cohorts.data && cohorts.data.cohorts.length === 0 ? (
        <EmptyState title="No cohorts in this period" description="No subscription started in a period that the service could group." />
      ) : (
        <DataTable
          rows={cohorts.data?.cohorts ?? []}
          rowKey={(row) => row.cohort}
          columns={[
            { key: 'cohort', header: 'Cohort', render: (row) => row.cohort },
            { key: 'size', header: 'Size', render: (row) => String(row.size) },
            ...Array.from({ length: retentionPeriods }, (_, index) => ({
              key: `period-${index}`,
              header: `Period ${index}`,
              render: (row: CohortRow) => {
                const cell = row.cells.find((candidate) => candidate.period === index);
                if (!cell) return '—';
                return `${cell.retentionRate === null ? 'Not available' : cell.retentionRate} (${cell.retained})`;
              },
            })),
          ]}
        />
      )}
      <p className="mt-2 text-xs text-muted">
        {cohorts.data?.methodology ?? 'Retention is measured on subscriptions the service could attribute to a cohort.'}
        {cohorts.data?.dataCompleteness ? ` Completeness: ${cohorts.data.dataCompleteness}.` : ''}
      </p>
    </Card>
  );
}
