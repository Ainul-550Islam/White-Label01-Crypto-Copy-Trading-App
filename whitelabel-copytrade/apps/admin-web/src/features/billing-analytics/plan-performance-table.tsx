'use client';

import type { JSX } from 'react';

import { billingAnalyticsApi, planRows, type RevenueQuery } from '@/api/billing-analytics-api';
import { Card, DataTable, EmptyState, ErrorNotice } from '@/components/ui';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/** Revenue and subscriber counts per plan, plus which plans actually carry the revenue. */
export function PlanPerformanceTable({ query }: { query: RevenueQuery }): JSX.Element {
  const plans = useResource(() => billingAnalyticsApi.getPlanPerformance({ ...query, limit: 20 }), [query], { errorMessage: 'Plan performance could not be loaded.' });
  const top = useResource(() => billingAnalyticsApi.getTopPlans({ ...query, limit: 5 }), [query], { errorMessage: 'Top plans could not be loaded.' });
  const distribution = useResource(() => billingAnalyticsApi.getPlanDistribution(query), [query], { errorMessage: 'Plan distribution could not be loaded.' });

  const money = (amount: string | null | undefined): string => (amount === null || amount === undefined ? 'Not available' : formatAmount(amount));

  return (
    <Card title="Plan performance">
      {plans.error ? (
        <ErrorNotice title="Plan performance" message={plans.error} />
      ) : planRows(plans.data).length === 0 ? (
        <EmptyState title="No plan revenue in this period" description="No invoice in the selected period was attributed to a plan." />
      ) : (
        <DataTable
          rows={planRows(plans.data)}
          rowKey={(row) => row.planId}
          columns={[
            { key: 'plan', header: 'Plan', render: (row) => row.planName ?? row.planCode ?? row.planId },
            { key: 'active-subscriptions', header: 'Active subscriptions', render: (row) => String(row.activeSubscriptions) },
            { key: 'recurring-revenue', header: 'Recurring revenue', render: (row) => money(row.mrr) },
            { key: 'annualised', header: 'Annualised', render: (row) => money(row.arr) },
            { key: 'churn', header: 'Churn', render: (row) => row.churnRate ?? 'Not available' },
            { key: 'revenue-per-account', header: 'Revenue per account', render: (row) => money(row.arpu) },
          ]}
        />
      )}
      {top.error && <ErrorNotice title="Top plans" message={top.error} />}
      {distribution.error && <ErrorNotice title="Plan distribution" message={distribution.error} />}
      {distribution.data && distribution.data.slices.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Distribution: {distribution.data.slices.map((slice) => `${slice.label ?? slice.key} ${slice.count}${slice.sharePercent ? ` (${slice.sharePercent})` : ''}`).join(' · ')}
        </p>
      )}
    </Card>
  );
}
