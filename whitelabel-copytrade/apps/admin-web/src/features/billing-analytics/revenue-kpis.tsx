'use client';

import type { JSX } from 'react';

import { billingAnalyticsApi, customerRows, type RevenueQuery } from '@/api/billing-analytics-api';
import { Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * The headline revenue numbers: recurring revenue, annualised recurring revenue, the period's revenue,
 * subscription counts, churn, expected customer value, ARPU and the largest customers.
 *
 * A metric the service could not compute arrives as null, and null is rendered as "Not available" with
 * the service's own completeness note underneath. It is never rendered as zero: an operator reading
 * "MRR 0" will conclude the business stopped, when the truth may be that no snapshot exists yet.
 */
export function RevenueKpis({ query }: { query: RevenueQuery }): JSX.Element {
  const recurring = useResource(() => billingAnalyticsApi.getMrr(query), [query], { errorMessage: 'Recurring revenue could not be loaded.' });
  const annualised = useResource(() => billingAnalyticsApi.getArr(query), [query], { errorMessage: 'Annual recurring revenue could not be loaded.' });
  const revenue = useResource(() => billingAnalyticsApi.getRevenueOverview(query), [query], { errorMessage: 'Revenue could not be loaded.' });
  const kpis = useResource(() => billingAnalyticsApi.getSubscriptionKpis(query), [query], { errorMessage: 'Subscription KPIs could not be loaded.' });
  const churn = useResource(() => billingAnalyticsApi.getChurn(query), [query], { errorMessage: 'Churn could not be loaded.' });
  const retention = useResource(() => billingAnalyticsApi.getRetention(query), [query], { errorMessage: 'Retention could not be loaded.' });
  const value = useResource(() => billingAnalyticsApi.getCustomerValue(query), [query], { errorMessage: 'Customer value could not be loaded.' });
  const arpu = useResource(() => billingAnalyticsApi.getArpu(query), [query], { errorMessage: 'Revenue per customer could not be loaded.' });
  const top = useResource(() => billingAnalyticsApi.getTopCustomers({ ...query, limit: 10 }), [query], { errorMessage: 'Top customers could not be loaded.' });

  const money = (amount: string | null | undefined, currency?: string): string =>
    amount === null || amount === undefined ? 'Not available' : `${formatAmount(amount)}${currency ? ` ${currency}` : ''}`;

  return (
    <section aria-labelledby="revenue-kpis-heading" className="grid gap-4">
      <h2 id="revenue-kpis-heading" className="text-lg font-semibold">Revenue</h2>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Recurring revenue" value={money(recurring.data?.mrr)} hint={recurring.data?.methodology ?? 'Monthly recurring revenue as the service computes it.'} />
        <StatTile label="Annualised recurring revenue" value={money(annualised.data?.arr)} hint={annualised.data?.methodology ?? 'Recurring revenue x 12, using the same definition.'} />
        <StatTile label="Revenue in the period" value={money(revenue.data?.totalRevenue)} hint={revenue.data?.dataCompleteness ?? 'Gross revenue recognised in the selected period.'} />
        <StatTile label="Net revenue" value={money(revenue.data?.netRevenue)} hint="After refunds and credits." />
        <StatTile label="Active subscriptions" value={kpis.data ? String(kpis.data.activeSubscriptions) : 'Not available'} hint={kpis.data?.trialingSubscriptions !== undefined ? `${kpis.data.trialingSubscriptions} trialing` : undefined} />
        <StatTile label="Churn" value={churn.data?.churnRate !== undefined ? String(churn.data.churnRate) : 'Not available'} hint={churn.data?.dataCompleteness} />
        <StatTile label="Retention" value={retention.data?.retentionRate !== undefined ? String(retention.data.retentionRate) : 'Not available'} hint={retention.data?.sampleSize !== undefined ? `Sample ${retention.data.sampleSize}` : undefined} />
        <StatTile label="Average customer value" value={money(value.data?.averageLifetimeValue)} hint={value.data?.customerCount !== undefined ? `${value.data.customerCount} customers` : undefined} />
        <StatTile label="Revenue per account" value={money(arpu.data?.arpu)} hint={arpu.data?.activeCustomers !== undefined ? `${arpu.data.activeCustomers} active accounts` : undefined} />
      </div>

      {recurring.error && <ErrorNotice title="Recurring revenue" message={recurring.error} />}
      {annualised.error && <ErrorNotice title="Annual recurring revenue" message={annualised.error} />}
      {revenue.error && <ErrorNotice title="Revenue" message={revenue.error} />}
      {kpis.error && <ErrorNotice title="Subscription KPIs" message={kpis.error} />}
      {churn.error && <ErrorNotice title="Churn" message={churn.error} />}

      <Card title="Largest customers in the period">
        {top.error ? (
          <ErrorNotice title="Top customers" message={top.error} />
        ) : top.data && customerRows(top.data).length === 0 ? (
          <EmptyState title="No customer revenue in this period" description="No invoice in the selected period was attributed to a customer." />
        ) : (
          <DataTable
            rows={customerRows(top.data)}
            rowKey={(row) => row.customerId}
            columns={[
              { key: 'customer', header: 'Customer', render: (row) => row.customerId },
              { key: 'revenue', header: 'Revenue', render: (row) => money(row.revenue) },
              { key: 'subscriptions', header: 'Subscriptions', render: (row) => (row.subscriptionCount === undefined ? 'Not available' : String(row.subscriptionCount)) },
            ]}
          />
        )}
      </Card>
    </section>
  );
}
