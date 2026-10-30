'use client';

import type { JSX } from 'react';

import { billingAnalyticsApi, type RevenueQuery } from '@/api/billing-analytics-api';
import { Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/** Cash in, cash out, the net position, and the invoices still outstanding for the same period. */
export function CashflowPanel({ query }: { query: RevenueQuery }): JSX.Element {
  const cashflow = useResource(() => billingAnalyticsApi.getCashflow(query), [query], { errorMessage: 'Cashflow could not be loaded.' });
  const outstanding = useResource(() => billingAnalyticsApi.getOutstanding(query), [query], { errorMessage: 'Outstanding invoices could not be loaded.' });

  const money = (amount: string | null | undefined): string => (amount === null || amount === undefined ? 'Not available' : formatAmount(amount));

  return (
    <Card title="Cashflow">
      {cashflow.error && <ErrorNotice title="Cashflow" message={cashflow.error} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Inflow" value={money(cashflow.data?.inflow)} />
        <StatTile label="Outflow" value={money(cashflow.data?.outflow)} />
        <StatTile label="Net cashflow" value={money(cashflow.data?.netCashflow)} />
        <StatTile
          label="Outstanding"
          value={money(outstanding.data?.totalOutstanding)}
          hint={outstanding.data ? `${outstanding.data.invoiceCount} invoices${outstanding.data.overdueCount ? `, ${outstanding.data.overdueCount} overdue` : ''}` : undefined}
        />
      </div>
      {outstanding.error && <ErrorNotice title="Outstanding invoices" message={outstanding.error} />}
      {(cashflow.data?.series ?? []).length === 0 ? (
        <EmptyState title="No cashflow series in this period" description="The service returned no period series for the selected range." />
      ) : (
        <DataTable
          rows={cashflow.data?.series ?? []}
          rowKey={(row) => row.period}
          columns={[
            { key: 'period', header: 'Period', render: (row) => row.period },
            { key: 'inflow', header: 'Inflow', render: (row) => money(row.inflow) },
            { key: 'outflow', header: 'Outflow', render: (row) => money(row.outflow) },
            { key: 'net', header: 'Net', render: (row) => money(row.net) },
          ]}
        />
      )}
    </Card>
  );
}
