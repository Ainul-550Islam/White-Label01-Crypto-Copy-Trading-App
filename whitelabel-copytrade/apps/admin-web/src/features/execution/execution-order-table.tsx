'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import {
  executionOrdersAdminApi,
  executionRows,
  type ExecutionOrder,
  type OrderListQuery,
} from '@/api/execution-orders-admin-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * Execution orders across the organisation, with the one mutation the
 * controller exposes: cancel with a mandatory reason.
 *
 * `unreconciledOnly` is offered as a first-class filter because that is the view
 * an operator needs during an incident - an order whose venue state is unknown
 * is not the same as one that failed.
 */
const CANCELLABLE = ['PENDING', 'NEW', 'OPEN', 'PARTIALLY_FILLED', 'SUBMITTED', 'ACKNOWLEDGED'];

export function ExecutionOrderTable(): JSX.Element {
  const [draft, setDraft] = useState<OrderListQuery>({});
  const [query, setQuery] = useState<OrderListQuery>({});
  const [version, setVersion] = useState(0);
  const orders = useResource(() => executionOrdersAdminApi.listOrders(query), [query, version], { errorMessage: 'Orders could not be loaded.' });

  const [cancelling, setCancelling] = useState<ExecutionOrder | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  async function cancel(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!cancelling) return;
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      setError('The API requires a reason of at least five characters for a cancel.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await executionOrdersAdminApi.cancelOrder(cancelling.id, { reason: trimmed }, crypto.randomUUID());
      setMessage(`Cancel requested for ${cancelling.symbol}. The state updates when the venue answers.`);
      setCancelling(null);
      setReason('');
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 409
          ? 'The order is no longer in a state that can be cancelled. Reload to see its current state.'
          : caught instanceof ApiError && caught.status === 403
            ? 'You do not have permission to cancel this order.'
            : 'The cancel was not confirmed. Check the order before retrying.',
      );
    } finally {
      setBusy(false);
    }
  }

  const rows = executionRows(orders.data).rows;
  const unreconciled = rows.filter((row) => row.reconciliationState && row.reconciliationState !== 'MATCHED').length;

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Filters" description="Narrow by account, symbol or state. Unreconciled orders are the ones to look at first during an incident.">
        <form
          onSubmit={(event) => { event.preventDefault(); setQuery({ ...draft }); }}
          aria-label="Filter execution orders"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: theme.space(3), alignItems: 'end' }}
        >
          {(
            [
              ['accountId', 'Account id'],
              ['strategyId', 'Strategy id'],
              ['symbol', 'Symbol'],
              ['status', 'Status'],
              ['reconciliationState', 'Reconciliation'],
            ] as Array<[keyof OrderListQuery, string]>
          ).map(([field, label]) => (
            <label key={field} style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              {label}
              <input
                value={(draft[field] as string | undefined) ?? ''}
                onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value || undefined }))}
                disabled={orders.loading}
              />
            </label>
          ))}
          <label style={{ display: 'flex', gap: theme.space(2), alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={Boolean(draft.unreconciledOnly)}
              onChange={(event) => setDraft((current) => ({ ...current, unreconciledOnly: event.target.checked || undefined }))}
              disabled={orders.loading}
            />
            Unreconciled only
          </label>
          <div style={{ display: 'flex', gap: theme.space(2) }}>
            <button type="submit" disabled={orders.loading}>Apply</button>
            <button type="button" disabled={orders.loading} onClick={() => { setDraft({}); setQuery({}); }}>Clear</button>
          </div>
        </form>
      </Card>

      <Card
        title="Execution orders"
        description="Orders the execution service has sent or attempted to send to a venue."
        actions={<button type="button" disabled={orders.loading} onClick={() => setVersion((current) => current + 1)}>Refresh</button>}
      >
        <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', marginBottom: theme.space(4) }}>
          <StatTile label="Orders" value={rows.length} />
          <StatTile label="Unreconciled" value={unreconciled} hint={unreconciled > 0 ? 'Venue state not confirmed' : 'All matched'} />
        </div>

        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: `0 0 ${theme.space(3)}`, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
        {error && <ErrorNotice title="Cancel not confirmed" message={error} />}
        {orders.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading orders…</p>}
        {orders.error && <ErrorNotice title="Orders unavailable" message={orders.error} />}

        {orders.data && (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            emptyTitle="No orders"
            emptyDescription="No execution order matches these filters."
            columns={[
              { key: 'symbol', header: 'Symbol', render: (row) => row.symbol },
              { key: 'side', header: 'Side', render: (row) => `${row.side} ${row.orderType}` },
              { key: 'qty', header: 'Quantity', align: 'right', render: (row) => formatAmount(row.quantity) },
              { key: 'filled', header: 'Filled', align: 'right', render: (row) => formatAmount(row.filledQuantity, { placeholder: '—' }) },
              { key: 'price', header: 'Price', align: 'right', render: (row) => formatAmount(row.price, { placeholder: 'Market' }) },
              { key: 'status', header: 'Status', render: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
              {
                key: 'recon',
                header: 'Reconciliation',
                render: (row) =>
                  row.reconciliationState ? <Badge tone={toneForStatus(row.reconciliationState)}>{row.reconciliationState}</Badge> : <span style={{ color: theme.color.textMuted }}>Not checked</span>,
              },
              { key: 'created', header: 'Created', render: (row) => formatDateTime(row.createdAt) },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) =>
                  CANCELLABLE.includes(row.status) ? (
                    <button type="button" disabled={busy} onClick={() => { setCancelling(row); setReason(''); setError(''); setMessage(''); }}>
                      Cancel
                    </button>
                  ) : (
                    <span style={{ color: theme.color.textMuted }}>—</span>
                  ),
              },
            ]}
          />
        )}
      </Card>

      {cancelling && (
        <Card title={`Cancel ${cancelling.symbol}`} description="The venue decides whether the cancel lands. A reason is required by the API and is kept with the request.">
          <form onSubmit={(event) => void cancel(event)} aria-label={`Cancel order ${cancelling.id.slice(0, 8)}`} style={{ display: 'grid', gap: theme.space(3), maxWidth: 520 }}>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Reason
              <textarea required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} />
            </label>
            <div style={{ display: 'flex', gap: theme.space(2) }}>
              <button type="submit" disabled={busy}>{busy ? 'Cancelling…' : 'Confirm cancel'}</button>
              <button type="button" disabled={busy} onClick={() => { setCancelling(null); setError(''); }}>Back</button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
