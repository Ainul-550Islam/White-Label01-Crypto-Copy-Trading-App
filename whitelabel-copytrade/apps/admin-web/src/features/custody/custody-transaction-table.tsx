'use client';

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import {
  custodyAdminApi,
  type CustodyPage,
  type CustodyTransaction,
  type TransactionListQuery,
} from '@/api/custody-admin-api';
import { Badge, Card, DataTable, EmptyState, ErrorNotice } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';

import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

const PAGE_SIZE = 25;
const STATUSES = [
  'PENDING',
  'SUBMITTED',
  'OBSERVED',
  'CONFIRMING',
  'CONFIRMED',
  'FINAL',
  'FAILED',
  'DROPPED',
  'REPLACED',
  'REORGED',
] as const;
const DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;

/**
 * Transaction monitoring.
 *
 * Filters and pagination are sent to the API (it supports page, limit, status,
 * direction, asset, network and wallet), so the console never pages a partial
 * local copy and calls it the full history.
 *
 * Selecting a row opens a detail panel that reads the transaction, its
 * confirmation chain and its actual fee from three routes. A platform operator
 * additionally gets "poll now", which asks the chain adapter to refresh the
 * observation; it is hidden and refused for tenant roles because the API marks
 * that route platform-only.
 */
export function CustodyTransactionTable({ canPoll }: { canPoll: boolean }): JSX.Element {
  const [filters, setFilters] = useState<{ status: string; direction: string; assetId: string; networkId: string; walletId: string }>({
    status: '',
    direction: '',
    assetId: '',
    networkId: '',
    walletId: '',
  });
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useMemo<TransactionListQuery>(
    () => ({
      page,
      limit: PAGE_SIZE,
      status: filters.status || undefined,
      direction: filters.direction || undefined,
      assetId: filters.assetId.trim() || undefined,
      networkId: filters.networkId.trim() || undefined,
      walletId: filters.walletId.trim() || undefined,
    }),
    [page, filters],
  );

  const list = useResource<CustodyPage<CustodyTransaction>>(
    () => custodyAdminApi.listTransactions(query),
    [query.status, query.direction, query.assetId, query.networkId, query.walletId, query.page],
    { errorMessage: 'The transaction list could not be loaded.' },
  );

  const detail = useResource(
    () => custodyAdminApi.getTransaction(selectedId ?? ''),
    [selectedId],
    { enabled: selectedId !== null, errorMessage: 'The transaction detail could not be loaded.' },
  );
  const confirmations = useResource(
    () => custodyAdminApi.getConfirmations(selectedId ?? ''),
    [selectedId],
    { enabled: selectedId !== null, errorMessage: 'Confirmation history could not be loaded.' },
  );
  const fee = useResource(
    () => custodyAdminApi.getActualFee(selectedId ?? ''),
    [selectedId],
    { enabled: selectedId !== null, errorMessage: 'The fee record could not be loaded.' },
  );

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  function update(field: keyof typeof filters, value: string): void {
    setPage(1);
    setFilters((current) => ({ ...current, [field]: value }));
  }

  async function poll(): Promise<void> {
    if (!selectedId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await custodyAdminApi.pollTransaction(selectedId, crypto.randomUUID());
      setMessage('The chain adapter was asked to refresh this transaction.');
      detail.reload();
      confirmations.reload();
      fee.reload();
    } catch {
      setError('The refresh could not be requested. The transaction state is unchanged.');
    } finally {
      setBusy(false);
    }
  }

  const rows = list.data?.data ?? [];
  const total = list.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card
        title="Transactions"
        description="Every custody movement the tenant has recorded, with its observation state and confirmation progress."
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: theme.space(3), marginBottom: theme.space(4) }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Status
            <select value={filters.status} onChange={(event) => update('status', event.target.value)} disabled={list.loading}>
              <option value="">All statuses</option>
              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Direction
            <select value={filters.direction} onChange={(event) => update('direction', event.target.value)} disabled={list.loading}>
              <option value="">Both directions</option>
              {DIRECTIONS.map((direction) => <option key={direction} value={direction}>{direction}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Asset
            <input value={filters.assetId} onChange={(event) => update('assetId', event.target.value)} placeholder="BTC" disabled={list.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Network
            <input value={filters.networkId} onChange={(event) => update('networkId', event.target.value)} placeholder="bitcoin" disabled={list.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Wallet ID
            <input value={filters.walletId} onChange={(event) => update('walletId', event.target.value)} disabled={list.loading} />
          </label>
        </div>

        {list.loading && rows.length === 0 && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading transactions…</p>}
        {list.error && <ErrorNotice title="Transactions unavailable" message={list.error} />}
        {!list.error && (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            emptyTitle="No transactions match these filters"
            emptyDescription="Clear a filter or widen the date range on the API to see older movements."
            columns={[
              {
                key: 'id',
                header: 'Transaction',
                render: (row) => (
                  <button
                    type="button"
                    onClick={() => { setSelectedId(row.id); setMessage(''); setError(''); }}
                    aria-pressed={selectedId === row.id}
                    style={{ padding: 0, background: 'none', border: 'none', color: theme.color.primary, cursor: 'pointer', font: 'inherit' }}
                  >
                    {row.id.slice(0, 8)}
                  </button>
                ),
              },
              { key: 'direction', header: 'Direction', render: (row) => <Badge tone={row.direction === 'INBOUND' ? 'info' : 'neutral'}>{row.direction}</Badge> },
              { key: 'amount', header: 'Amount', align: 'right', render: (row) => formatAmount(row.amount, { symbol: row.assetId }) },
              { key: 'network', header: 'Network', render: (row) => row.networkId },
              { key: 'confirmations', header: 'Confirmations', align: 'right', render: (row) => `${row.confirmationCount}/${row.requiredConfirmationCount}` },
              { key: 'status', header: 'Status', render: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
              { key: 'hash', header: 'Hash', render: (row) => <span style={{ fontSize: 12, color: theme.color.textMuted }}>{row.transactionHash ? `${row.transactionHash.slice(0, 14)}…` : 'Not observed yet'}</span> },
              { key: 'created', header: 'Created', render: (row) => formatDateTime(row.createdAt) },
            ]}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(3), marginTop: theme.space(4) }}>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || list.loading}>Previous</button>
          <span style={{ fontSize: 13, color: theme.color.textMuted }} aria-live="polite">
            Page {page} of {lastPage} · {total} transaction{total === 1 ? '' : 's'}
          </span>
          <button type="button" onClick={() => setPage((value) => Math.min(lastPage, value + 1))} disabled={page >= lastPage || list.loading}>Next</button>
        </div>
      </Card>

      {selectedId && (
        <Card
          title={`Transaction ${selectedId.slice(0, 8)}`}
          description="Monitoring detail: observation state, confirmation chain and the fee actually charged."
          actions={
            <div style={{ display: 'flex', gap: theme.space(2) }}>
              {canPoll && <button type="button" onClick={() => void poll()} disabled={busy}>Refresh from chain</button>}
              <button type="button" onClick={() => { setSelectedId(null); setMessage(''); setError(''); }}>Close</button>
            </div>
          }
        >
          <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: 0, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
          {error && <ErrorNotice title="Refresh not completed" message={error} />}

          {detail.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading transaction…</p>}
          {detail.error && <ErrorNotice title="Transaction unavailable" message={detail.error} />}
          {detail.data === null && !detail.loading && !detail.error && (
            <EmptyState title="Transaction not found" description="It may have been removed, or it belongs to another organisation." />
          )}
          {detail.data && (
            <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: theme.space(4), margin: `0 0 ${theme.space(5)}` }}>
              {[
                ['Status', detail.data.status],
                ['Direction', detail.data.direction],
                ['Amount', formatAmount(detail.data.amount, { symbol: detail.data.assetId })],
                ['Network', detail.data.networkId],
                ['Confirmations', `${detail.data.confirmationCount} of ${detail.data.requiredConfirmationCount}`],
                ['Block', detail.data.blockNumber ?? 'Not observed'],
                ['Transaction hash', detail.data.transactionHash ?? 'Not observed'],
                ['Recorded', formatDateTime(detail.data.createdAt)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: theme.color.textMuted }}>{label}</dt>
                  <dd style={{ margin: `${theme.space(1)} 0 0`, fontSize: 14, wordBreak: 'break-all' }}>{value}</dd>
                </div>
              ))}
            </dl>
          )}

          <h3 style={{ fontSize: 14, margin: `0 0 ${theme.space(3)}` }}>Confirmation chain</h3>
          {confirmations.error && <ErrorNotice title="Confirmations unavailable" message={confirmations.error} />}
          {confirmations.data && (
            <DataTable
              rows={confirmations.data}
              rowKey={(row) => row.id}
              emptyTitle="No confirmation observations yet"
              emptyDescription="The chain adapter has not reported a confirmation for this transaction."
              columns={[
                { key: 'state', header: 'State', render: (row) => <Badge tone={toneForStatus(row.state)}>{row.state}</Badge> },
                { key: 'count', header: 'Count', align: 'right', render: (row) => `${row.confirmationCount}/${row.requiredConfirmationCount}` },
                { key: 'block', header: 'Block', render: (row) => row.blockNumber ?? '—' },
                { key: 'observed', header: 'Observed', render: (row) => formatDateTime(row.observedAt) },
              ]}
            />
          )}

          <h3 style={{ fontSize: 14, margin: `${theme.space(5)} 0 ${theme.space(3)}` }}>Fee</h3>
          {fee.error && <ErrorNotice title="Fee unavailable" message={fee.error} />}
          {fee.data && (
            <p style={{ margin: 0, fontSize: 14 }}>
              {fee.data.isActual ? 'Actual fee' : 'Estimated fee'}:{' '}
              <strong>{formatAmount(fee.data.isActual ? fee.data.actualFee : fee.data.estimatedFee, { symbol: fee.data.feeAsset })}</strong>
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
