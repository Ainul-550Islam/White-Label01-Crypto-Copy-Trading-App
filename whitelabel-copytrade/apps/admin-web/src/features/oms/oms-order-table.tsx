'use client';

import { useMemo, useState, type JSX } from 'react';

import { omsAdminApi, toRows, type OmsOrderIntent } from '@/api/oms-admin-api';
import { Badge, Card, DataTable, ErrorNotice } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

const PAGE_SIZE = 25;

/**
 * The OMS order book: every intent the tenant has created, with the filters the
 * controller's `OmsOrdersQueryDto` declares. Filtering and paging are the API's
 * job, so the console never presents a local slice as the full history.
 */
export function OmsOrderTable({ onSelect, selectedId }: { onSelect: (id: string) => void; selectedId: string | null }): JSX.Element {
  const [filters, setFilters] = useState({ state: '', symbol: '', venue: '', accountId: '', search: '' });
  const [page, setPage] = useState(1);

  const query = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      state: filters.state || undefined,
      symbol: filters.symbol.trim() || undefined,
      venue: filters.venue.trim() || undefined,
      accountId: filters.accountId.trim() || undefined,
      search: filters.search.trim() || undefined,
    }),
    [page, filters],
  );

  const orders = useResource(
    () => omsAdminApi.searchOrders(query),
    [query.state, query.symbol, query.venue, query.accountId, query.search, query.page],
    { errorMessage: 'The order list could not be loaded.' },
  );

  const { rows, total } = toRows(orders.data);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function update(field: keyof typeof filters, value: string): void {
    setPage(1);
    setFilters((current) => ({ ...current, [field]: value }));
  }

  return (
    <Card title="Orders" description="Order intents with their state, fill progress and venue acknowledgement.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: theme.space(3), marginBottom: theme.space(4) }}>
        <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
          State
          <select value={filters.state} onChange={(event) => update('state', event.target.value)} disabled={orders.loading}>
            <option value="">All states</option>
            {['CREATED', 'VALIDATED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'RECONCILED'].map((state) => (
              <option key={state} value={state}>{state}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
          Symbol
          <input value={filters.symbol} onChange={(event) => update('symbol', event.target.value)} placeholder="BTC-USDT" disabled={orders.loading} />
        </label>
        <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
          Venue
          <input value={filters.venue} onChange={(event) => update('venue', event.target.value)} placeholder="BINANCE" disabled={orders.loading} />
        </label>
        <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
          Account
          <input value={filters.accountId} onChange={(event) => update('accountId', event.target.value)} disabled={orders.loading} />
        </label>
        <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
          Search
          <input value={filters.search} onChange={(event) => update('search', event.target.value)} placeholder="Client order id" disabled={orders.loading} />
        </label>
      </div>

      {orders.loading && rows.length === 0 && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading orders…</p>}
      {orders.error && <ErrorNotice title="Orders unavailable" message={orders.error} />}

      {!orders.error && (
        <>
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            emptyTitle="No orders match these filters"
            emptyDescription="Clear a filter to widen the search; orders stay available for audit after they terminate."
            columns={[
              {
                key: 'id',
                header: 'Order',
                render: (row: OmsOrderIntent) => (
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    aria-pressed={selectedId === row.id}
                    style={{ padding: 0, background: 'none', border: 'none', color: theme.color.primary, cursor: 'pointer', font: 'inherit' }}
                  >
                    {row.clientOrderId || row.id.slice(0, 8)}
                  </button>
                ),
              },
              { key: 'symbol', header: 'Symbol', render: (row: OmsOrderIntent) => row.symbol },
              { key: 'side', header: 'Side', render: (row: OmsOrderIntent) => <Badge tone={row.side === 'BUY' ? 'info' : 'neutral'}>{row.side}</Badge> },
              { key: 'type', header: 'Type', render: (row: OmsOrderIntent) => row.orderType },
              {
                key: 'quantity',
                header: 'Quantity',
                align: 'right',
                render: (row: OmsOrderIntent) => `${formatAmount(row.filledQuantity)} / ${formatAmount(row.quantity)}`,
              },
              { key: 'price', header: 'Price', align: 'right', render: (row: OmsOrderIntent) => formatAmount(row.price, { placeholder: 'Market' }) },
              { key: 'avg', header: 'Avg fill', align: 'right', render: (row: OmsOrderIntent) => formatAmount(row.averageFillPrice, { placeholder: '—' }) },
              { key: 'state', header: 'State', render: (row: OmsOrderIntent) => <Badge tone={toneForStatus(row.state)}>{row.state}</Badge> },
              { key: 'env', header: 'Env', render: (row: OmsOrderIntent) => row.environment },
              { key: 'created', header: 'Created', render: (row: OmsOrderIntent) => formatDateTime(row.createdAt) },
            ]}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(3), marginTop: theme.space(4) }}>
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || orders.loading}>Previous</button>
            <span style={{ fontSize: 13, color: theme.color.textMuted }} aria-live="polite">Page {page} of {lastPage} · {total} order{total === 1 ? '' : 's'}</span>
            <button type="button" onClick={() => setPage((value) => Math.min(lastPage, value + 1))} disabled={page >= lastPage || orders.loading}>Next</button>
          </div>
        </>
      )}
    </Card>
  );
}
