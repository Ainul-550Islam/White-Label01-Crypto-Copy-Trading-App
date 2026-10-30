'use client';

import { useState, type FormEvent, type JSX } from 'react';

import { omsAdminApi, toRows, type OrderRejection, type RejectionQuery } from '@/api/oms-admin-api';
import { Badge, Card, DataTable, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { useResource } from '@/features/shared/use-resource';

/**
 * Rejections and their statistics.
 *
 * The distinction that matters here is retriable vs not: retrying a rejected
 * order that the venue refused for a permanent reason (bad symbol, insufficient
 * permissions) just produces another rejection, so the flag is a column rather
 * than a footnote.
 *
 * The stats window is explicit. A default of "last 24 hours" is shown in the
 * inputs, so a reader never has to guess which period a count covers.
 */
function defaultFrom(): string {
  const now = new Date();
  return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

export function OmsRejections(): JSX.Element {
  const [draft, setDraft] = useState<RejectionQuery>({});
  const [query, setQuery] = useState<RejectionQuery>({});
  const [window, setWindow] = useState({ from: defaultFrom(), to: defaultTo() });
  const [statsWindow, setStatsWindow] = useState({ from: defaultFrom(), to: defaultTo() });

  const rejections = useResource(() => omsAdminApi.getRejections(query), [query], { errorMessage: 'Rejections could not be loaded.' });
  const stats = useResource(() => omsAdminApi.getRejectionStats(statsWindow.from, statsWindow.to), [statsWindow], { errorMessage: 'Rejection statistics could not be loaded.' });

  function applyStats(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setStatsWindow({ ...window });
  }

  const rows = toRows<OrderRejection>(rejections.data).rows;
  const retriable = rows.filter((row) => row.isRetriable).length;
  const totalByCategory = new Map<string, number>();
  for (const row of rows) totalByCategory.set(row.category, (totalByCategory.get(row.category) ?? 0) + 1);

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Statistics window" description="Counts cover the period you choose. Dates are inclusive of the whole day.">
        <form onSubmit={applyStats} aria-label="Choose a statistics window" style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            From
            <input type="date" required value={window.from} onChange={(event) => setWindow((current) => ({ ...current, from: event.target.value }))} disabled={stats.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            To
            <input type="date" required value={window.to} onChange={(event) => setWindow((current) => ({ ...current, to: event.target.value }))} disabled={stats.loading} />
          </label>
          <button type="submit" disabled={stats.loading}>Apply</button>
        </form>

        {stats.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading statistics…</p>}
        {stats.error && <ErrorNotice title="Statistics unavailable" message={stats.error} />}
        {stats.data && (
          <>
            <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', margin: `${theme.space(4)} 0` }}>
              <StatTile label="Rejections in window" value={stats.data.total} hint={`${stats.data.from} to ${stats.data.to}`} />
              <StatTile label="Categories" value={stats.data.byCategory.length} />
            </div>
            <DataTable
              rows={stats.data.byCategory}
              rowKey={(row) => row.category}
              emptyTitle="No rejections in this window"
              columns={[
                { key: 'category', header: 'Category', render: (row) => row.category },
                { key: 'count', header: 'Count', align: 'right', render: (row) => String(row.count) },
              ]}
            />
          </>
        )}
      </Card>

      <Card title="Rejections" description="Each refused order with the venue's own code and message, so the cause is not paraphrased by the console.">
        <form
          onSubmit={(event) => { event.preventDefault(); setQuery({ ...draft }); }}
          aria-label="Filter rejections"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: theme.space(3), alignItems: 'end', marginBottom: theme.space(4) }}
        >
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Category
            <input value={draft.category ?? ''} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value || undefined }))} disabled={rejections.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Account id
            <input value={draft.accountId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, accountId: event.target.value || undefined }))} disabled={rejections.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Symbol
            <input value={draft.symbol ?? ''} onChange={(event) => setDraft((current) => ({ ...current, symbol: event.target.value || undefined }))} disabled={rejections.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Venue
            <input value={draft.venue ?? ''} onChange={(event) => setDraft((current) => ({ ...current, venue: event.target.value || undefined }))} disabled={rejections.loading} />
          </label>
          <div style={{ display: 'flex', gap: theme.space(2) }}>
            <button type="submit" disabled={rejections.loading}>Apply</button>
            <button type="button" disabled={rejections.loading} onClick={() => { setDraft({}); setQuery({}); }}>Clear</button>
          </div>
        </form>

        <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', marginBottom: theme.space(4) }}>
          <StatTile label="Rejections" value={rows.length} />
          <StatTile label="Retriable" value={retriable} hint={retriable > 0 ? 'A retry can succeed' : 'None can be retried safely'} />
          <StatTile label="Categories" value={totalByCategory.size} />
        </div>

        {rejections.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading rejections…</p>}
        {rejections.error && <ErrorNotice title="Rejections unavailable" message={rejections.error} />}
        {rejections.data && (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            emptyTitle="No rejections"
            emptyDescription="Nothing has been refused for this filter."
            columns={[
              { key: 'category', header: 'Category', render: (row) => <Badge tone={toneForStatus(row.category)}>{row.category}</Badge> },
              { key: 'symbol', header: 'Symbol', render: (row) => `${row.symbol ?? '—'}${row.venue ? ` · ${row.venue}` : ''}` },
              { key: 'reason', header: 'Reason', render: (row) => row.reason },
              { key: 'code', header: 'Venue code', render: (row) => (row.providerCode ? <code style={{ fontSize: 12 }}>{row.providerCode}</code> : '—') },
              { key: 'retriable', header: 'Retriable', render: (row) => <Badge tone={row.isRetriable ? 'warning' : 'neutral'}>{row.isRetriable ? 'Yes' : 'No'}</Badge> },
              { key: 'at', header: 'At', render: (row) => formatDateTime(row.timestamp) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
