'use client';

import { useState, type FormEvent, type JSX } from 'react';

import { omsAdminApi, toRows, type OmsAllocation } from '@/api/oms-admin-api';
import { Card, DataTable, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * Copy-trading allocations: how a master order was split across follower
 * accounts.
 *
 * The summary is the reason this page exists. An allocation list can look
 * plausible while the totals do not add up, so the console shows the summed
 * notional next to the count and the per-symbol breakdown from the service
 * rather than recomputing it in the browser.
 */
interface AllocationFilter {
  accountId?: string;
  strategyId?: string;
  traderId?: string;
  followerId?: string;
  symbol?: string;
}

export function OmsAllocations(): JSX.Element {
  const [draft, setDraft] = useState<AllocationFilter>({});
  const [query, setQuery] = useState<AllocationFilter>({});

  const summary = useResource(() => omsAdminApi.getAllocationSummary({ strategyId: query.strategyId, traderId: query.traderId, followerId: query.followerId }), [query], {
    errorMessage: 'The allocation summary could not be loaded.',
  });
  const allocations = useResource(() => omsAdminApi.getAllocations(query), [query], { errorMessage: 'Allocations could not be loaded.' });

  const rows = toRows<OmsAllocation>(allocations.data).rows;

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Filters" description="Narrow allocations by account, strategy, trader, follower or symbol.">
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setQuery({ ...draft }); }}
          aria-label="Filter allocations"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: theme.space(3), alignItems: 'end' }}
        >
          {(
            [
              ['accountId', 'Account id'],
              ['strategyId', 'Strategy id'],
              ['traderId', 'Trader id'],
              ['followerId', 'Follower id'],
              ['symbol', 'Symbol'],
            ] as Array<[keyof AllocationFilter, string]>
          ).map(([field, label]) => (
            <label key={field} style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              {label}
              <input value={draft[field] ?? ''} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value || undefined }))} disabled={allocations.loading} />
            </label>
          ))}
          <div style={{ display: 'flex', gap: theme.space(2) }}>
            <button type="submit" disabled={allocations.loading}>Apply</button>
            <button type="button" disabled={allocations.loading} onClick={() => { setDraft({}); setQuery({}); }}>Clear</button>
          </div>
        </form>
      </Card>

      <Card title="Summary" description="Totals as the OMS reports them for this filter.">
        {summary.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading summary…</p>}
        {summary.error && <ErrorNotice title="Summary unavailable" message={summary.error} />}
        {summary.data && (
          <>
            <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', marginBottom: theme.space(4) }}>
              <StatTile label="Allocations" value={summary.data.totalAllocations} />
              <StatTile label="Notional" value={formatAmount(summary.data.totalNotional)} />
              <StatTile label="Symbols" value={summary.data.bySymbol.length} />
            </div>
            <DataTable
              rows={summary.data.bySymbol}
              rowKey={(row) => row.symbol}
              emptyTitle="No allocations to summarise"
              columns={[
                { key: 'symbol', header: 'Symbol', render: (row) => row.symbol },
                { key: 'count', header: 'Allocations', align: 'right', render: (row) => String(row.count) },
                { key: 'notional', header: 'Notional', align: 'right', render: (row) => formatAmount(row.notional) },
              ]}
            />
          </>
        )}
      </Card>

      <Card title="Allocations" description="Each row is one follower's share of a filled order.">
        {allocations.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading allocations…</p>}
        {allocations.error && <ErrorNotice title="Allocations unavailable" message={allocations.error} />}
        {allocations.data && (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            emptyTitle="No allocations"
            emptyDescription="No copy-trading order has been split for this filter yet."
            columns={[
              { key: 'symbol', header: 'Symbol', render: (row) => row.symbol ?? '—' },
              { key: 'follower', header: 'Follower', render: (row) => (row.followerId ? <code style={{ fontSize: 12 }}>{row.followerId.slice(0, 8)}</code> : '—') },
              { key: 'qty', header: 'Quantity', align: 'right', render: (row) => formatAmount(row.quantity) },
              { key: 'price', header: 'Price', align: 'right', render: (row) => formatAmount(row.price) },
              { key: 'notional', header: 'Notional', align: 'right', render: (row) => formatAmount(row.notional) },
              { key: 'fee', header: 'Fee', align: 'right', render: (row) => formatAmount(row.fee) },
              { key: 'at', header: 'Allocated', render: (row) => formatDateTime(row.createdAt) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
