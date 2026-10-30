'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import { billingAnalyticsApi, customerRows, planRows, type PeriodQuery, type RevenueQuery } from '@/api/billing-analytics-api';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * Revenue analytics for the organisation.
 *
 * Every figure here arrives as a decimal string or as null, and null means the
 * service could not compute it. The console shows "Not available" for those
 * rather than a zero, and prints the response's own provenance (`computedAt`,
 * `dataCompleteness`) under each card, because a stale or partial metric that
 * looks authoritative is worse than no metric.
 *
 * `GET cache/invalidate` is a GET that mutates server state. It is deliberately
 * not wired to a page load or to a refresh - the operator presses a button, and
 * the button says what it does.
 */
const PERIODS: Array<NonNullable<PeriodQuery['periodType']>> = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'];

function isoDay(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function BillingAnalyticsDashboard(): JSX.Element {
  const [draft, setDraft] = useState<RevenueQuery>({ periodType: 'MONTH', startDate: isoDay(-30), endDate: isoDay(0) });
  const [query, setQuery] = useState<RevenueQuery>(draft);

  const revenue = useResource(() => billingAnalyticsApi.getRevenueOverview(query), [query], { errorMessage: 'Revenue could not be loaded.' });
  const mrr = useResource(() => billingAnalyticsApi.getMrr(query), [query], { errorMessage: 'Recurring revenue could not be loaded.' });
  const arr = useResource(() => billingAnalyticsApi.getArr(query), [query], { errorMessage: 'Annual recurring revenue could not be loaded.' });
  const kpis = useResource(() => billingAnalyticsApi.getSubscriptionKpis(query), [query], { errorMessage: 'Subscription KPIs could not be loaded.' });
  const churn = useResource(() => billingAnalyticsApi.getChurn(query), [query], { errorMessage: 'Churn could not be loaded.' });
  const retention = useResource(() => billingAnalyticsApi.getRetention(query), [query], { errorMessage: 'Retention could not be loaded.' });
  const cashflow = useResource(() => billingAnalyticsApi.getCashflow(query), [query], { errorMessage: 'Cashflow could not be loaded.' });
  const outstanding = useResource(() => billingAnalyticsApi.getOutstanding(query), [query], { errorMessage: 'Outstanding invoices could not be loaded.' });
  const health = useResource(() => billingAnalyticsApi.getBillingHealth(query), [query], { errorMessage: 'Billing health could not be loaded.' });
  const reconciliation = useResource(() => billingAnalyticsApi.getReconciliation(query), [query], { errorMessage: 'Reconciliation could not be loaded.' });
  const plans = useResource(() => billingAnalyticsApi.getPlanPerformance({ ...query, limit: 20 }), [query], { errorMessage: 'Plan performance could not be loaded.' });
  const topCustomers = useResource(() => billingAnalyticsApi.getTopCustomers({ ...query, limit: 10 }), [query], { errorMessage: 'Top customers could not be loaded.' });
  const cohorts = useResource(() => billingAnalyticsApi.getCohorts({ ...query, retentionPeriods: 6 }), [query], { errorMessage: 'Cohorts could not be loaded.' });
  const recognition = useResource(() => billingAnalyticsApi.getRecognition(query), [query], { errorMessage: 'Revenue recognition could not be loaded.' });
  const report = useResource(() => billingAnalyticsApi.getFinancialReport(query), [query], { errorMessage: 'The financial report could not be loaded.' });

  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheMessage, setCacheMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (cacheMessage || error) statusRef.current?.focus();
  }, [cacheMessage, error]);

  function apply(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setQuery({ ...draft });
  }

  async function invalidateCache(): Promise<void> {
    setCacheBusy(true);
    setError('');
    setCacheMessage('');
    try {
      const result = await billingAnalyticsApi.invalidateCache('REVENUE', draft.periodType);
      setCacheMessage(
        result.invalidated
          ? `Cached analytics were invalidated${result.invalidatedAt ? ` at ${formatDateTime(result.invalidatedAt)}` : ''}. Figures refresh on the next load.`
          : 'The service did not invalidate anything; the cache is unchanged.',
      );
    } catch {
      setError('The cache was not invalidated. Figures may be stale until it is.');
    } finally {
      setCacheBusy(false);
    }
  }

  const provenance = revenue.data
    ? [revenue.data.computedAt ? `computed ${formatDateTime(revenue.data.computedAt)}` : null, revenue.data.dataCompleteness ? `completeness ${revenue.data.dataCompleteness}` : null]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Period" description="Every figure below covers this window. Leave the dates blank to let the service apply its own default.">
        <form onSubmit={apply} aria-label="Choose an analytics period" style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Period type
            <select value={draft.periodType ?? 'MONTH'} onChange={(event) => setDraft((current) => ({ ...current, periodType: event.target.value as PeriodQuery['periodType'] }))} disabled={revenue.loading}>
              {PERIODS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Start
            <input type="date" value={draft.startDate ?? ''} onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value || undefined }))} disabled={revenue.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            End
            <input type="date" value={draft.endDate ?? ''} onChange={(event) => setDraft((current) => ({ ...current, endDate: event.target.value || undefined }))} disabled={revenue.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Currency
            <input value={draft.currency ?? ''} onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value || undefined }))} disabled={revenue.loading} />
          </label>
          <button type="submit" disabled={revenue.loading}>Apply</button>
          <button type="button" disabled={cacheBusy} onClick={() => void invalidateCache()}>
            {cacheBusy ? 'Invalidating…' : 'Invalidate cached figures'}
          </button>
        </form>

        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: `${theme.space(3)} 0 0`, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{cacheMessage}</p>
        {error && <ErrorNotice title="Cache not invalidated" message={error} />}
      </Card>

      <Card title="Revenue" description={provenance || 'Totals for the selected window.'}>
        {revenue.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading revenue…</p>}
        {revenue.error && <ErrorNotice title="Revenue unavailable" message={revenue.error} />}
        {revenue.data && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: theme.space(3) }}>
            <StatTile label="Total revenue" value={formatAmount(revenue.data.totalRevenue)} />
            <StatTile label="Net revenue" value={formatAmount(revenue.data.netRevenue)} />
            <StatTile label="Recurring" value={formatAmount(revenue.data.recurringRevenue)} />
            <StatTile label="One-time" value={formatAmount(revenue.data.oneTimeRevenue)} />
            <StatTile label="Refunds" value={formatAmount(revenue.data.refunds)} />
            <StatTile label="Growth" value={revenue.data.growthRate ?? 'Not available'} hint={revenue.data.previousPeriod ? `Previous ${formatAmount(revenue.data.previousPeriod.totalRevenue)}` : undefined} />
          </div>
        )}
      </Card>

      <Card title="Recurring revenue and subscriptions">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: theme.space(3) }}>
          <StatTile label="MRR" value={formatAmount(mrr.data?.mrr ?? null)} hint={mrr.data?.activeSubscriptions !== undefined ? `${mrr.data.activeSubscriptions} active` : undefined} />
          <StatTile label="ARR" value={formatAmount(arr.data?.arr ?? null)} />
          <StatTile label="ARPA" value={formatAmount(mrr.data?.arpa ?? null)} />
          <StatTile label="Active subscriptions" value={kpis.data?.activeSubscriptions ?? '—'} />
          <StatTile label="Trialing" value={kpis.data?.trialingSubscriptions ?? '—'} />
          <StatTile label="New in period" value={kpis.data?.newSubscriptions ?? '—'} />
          <StatTile label="Churned" value={kpis.data?.churnedSubscriptions ?? '—'} />
          <StatTile label="Conversion" value={kpis.data?.conversionRate ?? 'Not available'} />
          <StatTile label="Churn rate" value={churn.data?.churnRate ?? 'Not available'} hint={churn.data?.revenueChurnRate ? `Revenue churn ${churn.data.revenueChurnRate}` : undefined} />
          <StatTile
            label="Retention"
            value={retention.data?.retentionRate ?? 'Not available'}
            hint={retention.data ? `${retention.data.retainedSubscriptions} of ${retention.data.cohortSize}` : undefined}
          />
        </div>
      </Card>

      <Card title="Cashflow and outstanding">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: theme.space(3) }}>
          <StatTile label="Inflow" value={formatAmount(cashflow.data?.inflow ?? null)} />
          <StatTile label="Outflow" value={formatAmount(cashflow.data?.outflow ?? null)} />
          <StatTile label="Net cashflow" value={formatAmount(cashflow.data?.netCashflow ?? null)} />
          <StatTile label="Outstanding" value={formatAmount(outstanding.data?.totalOutstanding ?? null)} hint={outstanding.data ? `${outstanding.data.invoiceCount} invoice(s)` : undefined} />
          <StatTile
            label="Overdue"
            value={formatAmount(outstanding.data?.overdueAmount ?? null)}
            hint={outstanding.data?.overdueCount !== undefined ? `${outstanding.data.overdueCount} invoice(s)` : undefined}
          />
        </div>
        {cashflow.data?.series && cashflow.data.series.length > 0 && (
          <div style={{ marginTop: theme.space(4) }}>
            <DataTable
              rows={cashflow.data.series}
              rowKey={(row) => row.period}
              emptyTitle="No cashflow series"
              columns={[
                { key: 'period', header: 'Period', render: (row) => row.period },
                { key: 'inflow', header: 'Inflow', align: 'right', render: (row) => formatAmount(row.inflow) },
                { key: 'outflow', header: 'Outflow', align: 'right', render: (row) => formatAmount(row.outflow) },
                { key: 'net', header: 'Net', align: 'right', render: (row) => formatAmount(row.net) },
              ]}
            />
          </div>
        )}
      </Card>

      <Card title="Billing health" description="Operational state of billing itself: failed payments, dunning and stuck notifications.">
        {health.error && <ErrorNotice title="Billing health unavailable" message={health.error} />}
        {health.data && (
          <>
            <p style={{ marginTop: 0, fontSize: 13 }}>
              <Badge tone={health.data.healthy ? 'success' : 'danger'}>{health.data.healthy ? 'Healthy' : 'Needs attention'}</Badge>
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: theme.space(3) }}>
              <StatTile label="Failed payments" value={health.data.failedPayments ?? '—'} />
              <StatTile label="Dunning active" value={health.data.dunningActive ?? '—'} />
              <StatTile label="Stuck notifications" value={health.data.stuckNotifications ?? '—'} />
            </div>
            {health.data.issues && health.data.issues.length > 0 && (
              <ul style={{ margin: `${theme.space(3)} 0 0`, paddingLeft: 20, fontSize: 13, color: theme.color.danger }}>
                {health.data.issues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            )}
          </>
        )}
      </Card>

      <Card title="Revenue recognition">
        {recognition.error && <ErrorNotice title="Recognition unavailable" message={recognition.error} />}
        {recognition.data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: theme.space(3), marginBottom: theme.space(4) }}>
              <StatTile label="Recognised" value={formatAmount(recognition.data.recognizedRevenue)} />
              <StatTile label="Deferred" value={formatAmount(recognition.data.deferredRevenue)} />
            </div>
            {recognition.data.schedule && recognition.data.schedule.length > 0 && (
              <DataTable
                rows={recognition.data.schedule}
                rowKey={(row) => row.period}
                emptyTitle="No schedule"
                columns={[
                  { key: 'period', header: 'Period', render: (row) => row.period },
                  { key: 'amount', header: 'Amount', align: 'right', render: (row) => formatAmount(row.amount) },
                ]}
              />
            )}
          </>
        )}
      </Card>

      <Card title="Plan performance">
        {plans.error && <ErrorNotice title="Plans unavailable" message={plans.error} />}
        {plans.data && (
          <DataTable
            rows={planRows(plans.data)}
            rowKey={(row) => row.planId}
            emptyTitle="No plan performance"
            emptyDescription="No subscription is active on any plan in this window."
            columns={[
              { key: 'plan', header: 'Plan', render: (row) => row.planName ?? row.planCode ?? row.planId.slice(0, 8) },
              { key: 'subs', header: 'Subscriptions', align: 'right', render: (row) => String(row.activeSubscriptions) },
              { key: 'mrr', header: 'MRR', align: 'right', render: (row) => formatAmount(row.mrr) },
              { key: 'arr', header: 'ARR', align: 'right', render: (row) => formatAmount(row.arr ?? null) },
              { key: 'churn', header: 'Churn', align: 'right', render: (row) => row.churnRate ?? 'Not available' },
            ]}
          />
        )}
      </Card>

      <Card title="Top customers">
        {topCustomers.error && <ErrorNotice title="Top customers unavailable" message={topCustomers.error} />}
        {topCustomers.data && (
          <DataTable
            rows={customerRows(topCustomers.data)}
            rowKey={(row) => row.customerId}
            emptyTitle="No customers to rank"
            columns={[
              { key: 'customer', header: 'Customer', render: (row) => <code style={{ fontSize: 12 }}>{row.customerId.slice(0, 8)}</code> },
              { key: 'revenue', header: 'Revenue', align: 'right', render: (row) => formatAmount(row.revenue) },
              { key: 'subs', header: 'Subscriptions', align: 'right', render: (row) => (row.subscriptionCount === undefined ? '—' : String(row.subscriptionCount)) },
            ]}
          />
        )}
      </Card>

      <Card title="Cohort retention" description="Each row is a signup cohort; each cell is the share still subscribed after N periods.">
        {cohorts.error && <ErrorNotice title="Cohorts unavailable" message={cohorts.error} />}
        {cohorts.data && cohorts.data.cohorts.length === 0 && <EmptyState title="No cohorts" description="No signup cohort falls inside this window." />}
        {cohorts.data && cohorts.data.cohorts.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
              <caption style={{ textAlign: 'left', paddingBottom: theme.space(2), color: theme.color.textMuted, fontSize: 12 }}>
                Retention rate by cohort period, as reported by the analytics service.
              </caption>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: 'left', padding: 8 }}>Cohort</th>
                  <th scope="col" style={{ textAlign: 'right', padding: 8 }}>Size</th>
                  {Array.from({ length: Math.max(...cohorts.data.cohorts.map((row) => row.cells.length), 0) }, (_, index) => (
                    <th key={index} scope="col" style={{ textAlign: 'right', padding: 8 }}>P{index}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.data.cohorts.map((row) => (
                  <tr key={row.cohort}>
                    <th scope="row" style={{ textAlign: 'left', padding: 8, fontWeight: 500 }}>{row.cohort}</th>
                    <td style={{ textAlign: 'right', padding: 8 }}>{row.size}</td>
                    {row.cells.map((cell) => (
                      <td key={cell.period} style={{ textAlign: 'right', padding: 8 }}>{cell.retentionRate === null ? '—' : cell.retentionRate}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Reconciliation" description="Billing's internal records against the payment provider's. A null result means the comparison did not run.">
        {reconciliation.error && <ErrorNotice title="Reconciliation unavailable" message={reconciliation.error} />}
        {reconciliation.data && (
          <>
            <p style={{ marginTop: 0, fontSize: 13 }}>
              <Badge tone={reconciliation.data.matched === true ? 'success' : reconciliation.data.matched === false ? 'danger' : 'warning'}>
                {reconciliation.data.matched === true ? 'Matched' : reconciliation.data.matched === false ? 'Discrepancies' : 'Not compared'}
              </Badge>{' '}
              {reconciliation.data.checkedRecords !== undefined ? `${reconciliation.data.checkedRecords} record(s) checked` : ''}
            </p>
            {reconciliation.data.discrepancies.length > 0 && (
              <DataTable
                rows={reconciliation.data.discrepancies}
                rowKey={(row, index) => row.reference ?? `${row.type}-${index}`}
                emptyTitle="No discrepancies"
                columns={[
                  { key: 'type', header: 'Type', render: (row) => row.type },
                  { key: 'ref', header: 'Reference', render: (row) => row.reference ?? '—' },
                  { key: 'expected', header: 'Expected', align: 'right', render: (row) => formatAmount(row.expected) },
                  { key: 'actual', header: 'Actual', align: 'right', render: (row) => formatAmount(row.actual) },
                ]}
              />
            )}
          </>
        )}
      </Card>

      <Card title="Financial report" description="The service's own statement for the window, including its section breakdown.">
        {report.error && <ErrorNotice title="Report unavailable" message={report.error} />}
        {report.data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: theme.space(3), marginBottom: theme.space(4) }}>
              <StatTile label="Revenue" value={formatAmount(report.data.revenue)} hint={`${report.data.periodStart} to ${report.data.periodEnd}`} />
              <StatTile label="Expenses" value={formatAmount(report.data.expenses ?? null)} />
              <StatTile label="Net income" value={formatAmount(report.data.netIncome ?? null)} />
              <StatTile label="Deferred" value={formatAmount(report.data.deferredRevenue ?? null)} />
            </div>
            {(report.data.sections ?? []).map((section) => (
              <div key={section.title} style={{ marginBottom: theme.space(4) }}>
                <h3 style={{ fontSize: 14, margin: `0 0 ${theme.space(2)}` }}>{section.title}</h3>
                <DataTable
                  rows={section.lines}
                  rowKey={(row) => row.label}
                  emptyTitle="No lines"
                  columns={[
                    { key: 'label', header: 'Line', render: (row) => row.label },
                    { key: 'amount', header: 'Amount', align: 'right', render: (row) => formatAmount(row.amount) },
                  ]}
                />
              </div>
            ))}
          </>
        )}
      </Card>
    </div>
  );
}
