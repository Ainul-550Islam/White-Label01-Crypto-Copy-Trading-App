'use client';

import type { JSX } from 'react';

import { billingAnalyticsApi, type RevenueQuery } from '@/api/billing-analytics-api';
import { Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * Revenue recognition: what has been recognised in the period and what is still deferred.
 *
 * The two figures answer different accounting questions and are shown side by side rather than netted:
 * a period can recognise revenue collected months earlier, and deferred revenue is money the tenant
 * owes service for, not money it has earned.
 */
export function RecognitionPanel({ query }: { query: RevenueQuery }): JSX.Element {
  const recognition = useResource(() => billingAnalyticsApi.getRecognition(query), [query], { errorMessage: 'Revenue recognition could not be loaded.' });
  const deferred = useResource(() => billingAnalyticsApi.getDeferred(query), [query], { errorMessage: 'Deferred revenue could not be loaded.' });

  const money = (amount: string | null | undefined): string => (amount === null || amount === undefined ? 'Not available' : formatAmount(amount));

  return (
    <Card title="Revenue recognition">
      {recognition.error && <ErrorNotice title="Recognised revenue" message={recognition.error} />}
      {deferred.error && <ErrorNotice title="Deferred revenue" message={deferred.error} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <StatTile label="Recognised" value={money(recognition.data?.recognizedRevenue)} hint={recognition.data?.periodStart ? `${recognition.data.periodStart} to ${recognition.data.periodEnd ?? ''}` : undefined} />
        <StatTile label="Deferred" value={money(recognition.data?.deferredRevenue ?? deferred.data?.deferredRevenue)} hint="Invoiced, not yet earned." />
      </div>
      {(recognition.data?.schedule ?? []).length === 0 ? (
        <EmptyState title="No recognition schedule" description="No recognition entry falls in the selected period." />
      ) : (
        <DataTable
          rows={recognition.data?.schedule ?? []}
          rowKey={(row) => row.period}
          columns={[
            { key: 'period', header: 'Period', render: (row) => row.period },
            { key: 'recognised', header: 'Recognised', render: (row) => money(row.amount) },
          ]}
        />
      )}
    </Card>
  );
}
