'use client';

import { useState, type JSX } from 'react';

import { billingAnalyticsApi, type RevenueQuery } from '@/api/billing-analytics-api';
import { Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * The service's own financial report, plus the cache-invalidate control.
 *
 * `GET cache/invalidate` is a GET that changes server state, so it is never wired to a page load: the
 * operator presses the button, the button names the scope it will clear, and the result is announced.
 * The report itself is rendered exactly as the service published it - sections and lines in its order,
 * with its own generated-at timestamp - because a report the console re-sorts is no longer the report
 * that was signed off.
 */
export function FinancialReportPanel({ query }: { query: RevenueQuery }): JSX.Element {
  const report = useResource(() => billingAnalyticsApi.getFinancialReport(query), [query], { errorMessage: 'The financial report could not be loaded.' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const money = (amount: string | null | undefined): string => (amount === null || amount === undefined ? 'Not available' : formatAmount(amount));

  const invalidate = async (): Promise<void> => {
    setBusy(true);
    setMessage('');
    try {
      const result = await billingAnalyticsApi.invalidateCache('analytics');
      setMessage(result.invalidated ? `Cache cleared for ${result.scope}.` : `The service did not clear ${result.scope}.`);
      report.reload();
    } catch {
      setMessage('The cache could not be cleared.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Financial report">
      {report.error && <ErrorNotice title="Financial report" message={report.error} />}
      {report.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Revenue" value={money(report.data.revenue)} hint={`${report.data.periodStart} to ${report.data.periodEnd}`} />
            <StatTile label="Recognised" value={money(report.data.recognizedRevenue)} />
            <StatTile label="Deferred" value={money(report.data.deferredRevenue)} />
            <StatTile label="Net income" value={money(report.data.netIncome)} hint={report.data.generatedAt ? `Generated ${report.data.generatedAt}` : undefined} />
          </div>
          {(report.data.sections ?? []).length === 0 ? (
            <EmptyState title="The report has no sections" description="The service published totals only for this period." />
          ) : (
            (report.data.sections ?? []).map((section) => (
              <div key={section.title} className="mt-3">
                <h3 className="text-sm font-semibold">{section.title}</h3>
                <DataTable
                  rows={section.lines}
                  rowKey={(line) => `${section.title}-${line.label}`}
                  columns={[
                    { key: 'line', header: 'Line', render: (line) => line.label },
                    { key: 'amount', header: 'Amount', render: (line) => money(line.amount) },
                  ]}
                />
              </div>
            ))
          )}
        </>
      ) : (
        <EmptyState title="No report for this period" description="Choose a period the service has closed." />
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => void invalidate()} disabled={busy}>
          Clear analytics cache
        </button>
        <span className="text-xs text-muted">Clearing the cache recomputes these figures on the next read. It changes no billing record.</span>
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-[1.25rem] text-sm">{message}</p>
    </Card>
  );
}
