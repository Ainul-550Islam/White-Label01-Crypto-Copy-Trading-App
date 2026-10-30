'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import {
  executionOrdersAdminApi,
  executionRows,
  LIVE_TRADING_CONFIRMATION,
  type AccountBalance,
  type AccountListQuery,
  type ExchangeAccount,
} from '@/api/execution-orders-admin-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, EmptyState, ErrorNotice } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * Exchange accounts: connectivity, balances, streams and the three switches the
 * controller exposes (enabled, private stream, live trading).
 *
 * Live trading is the one control that moves real money, so it is guarded three
 * ways, all required by the API itself:
 *
 *  * enabling needs the typed phrase `ENABLE LIVE TRADING`;
 *  * disabling only needs a reason, because turning risk *off* should never be
 *    harder than turning it on;
 *  * both need a reason of at least five characters.
 *
 * API keys and secrets are never sent to this page - the client type has no
 * field for them and the console never asks for one.
 */
export function ExchangeAccountTable(): JSX.Element {
  const [query, setQuery] = useState<AccountListQuery>({});
  const [version, setVersion] = useState(0);
  const accounts = useResource(() => executionOrdersAdminApi.listAccounts(query), [query, version], { errorMessage: 'Exchange accounts could not be loaded.' });

  const [selected, setSelected] = useState<ExchangeAccount | null>(null);
  const [switching, setSwitching] = useState<{ account: ExchangeAccount; op: 'enabled' | 'liveTrading' | 'privateStream'; next: boolean } | null>(null);
  const [form, setForm] = useState({ reason: '', confirmation: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  async function runSimple(account: ExchangeAccount, op: 'verify' | 'refresh' | 'resync'): Promise<void> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (op === 'verify') {
        await executionOrdersAdminApi.verifyAccount(account.id, crypto.randomUUID());
        setMessage(`${account.label ?? account.venue} was re-verified with the venue.`);
      } else if (op === 'refresh') {
        await executionOrdersAdminApi.refreshBalances(account.id, crypto.randomUUID());
        setMessage('Balances were refreshed from the venue.');
      } else {
        await executionOrdersAdminApi.resyncStream(account.id, crypto.randomUUID());
        setMessage('The private stream was re-established.');
      }
      setVersion((current) => current + 1);
    } catch {
      setError('The request was not completed. Nothing about the account changed.');
    } finally {
      setBusy(false);
    }
  }

  async function applySwitch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!switching) return;
    const reason = form.reason.trim();
    if (reason.length < 5) {
      setError('The API requires a reason of at least five characters.');
      return;
    }
    if (switching.op === 'liveTrading' && switching.next && form.confirmation.trim() !== LIVE_TRADING_CONFIRMATION) {
      setError(`Type ${LIVE_TRADING_CONFIRMATION} exactly to enable live trading.`);
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    const { account, op, next } = switching;
    try {
      if (op === 'enabled') {
        await executionOrdersAdminApi.setEnabled(account.id, { enabled: next, reason }, crypto.randomUUID());
      } else if (op === 'privateStream') {
        await executionOrdersAdminApi.setPrivateStream(account.id, { enabled: next, reason }, crypto.randomUUID());
      } else {
        await executionOrdersAdminApi.setLiveTrading(
          account.id,
          { enabled: next, reason, ...(next ? { confirmation: form.confirmation.trim() } : {}) },
          crypto.randomUUID(),
        );
      }
      setMessage(
        op === 'liveTrading'
          ? next
            ? 'Live trading is now enabled for this account. Orders placed from now on can reach the real venue.'
            : 'Live trading is disabled for this account.'
          : `${op === 'enabled' ? 'The account' : 'The private stream'} is now ${next ? 'enabled' : 'disabled'}.`,
      );
      setSwitching(null);
      setForm({ reason: '', confirmation: '' });
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 403
          ? 'You do not have permission to change this setting.'
          : caught instanceof ApiError && caught.status === 409
            ? 'The account changed since this page loaded. Reload before retrying.'
            : caught instanceof ApiError && caught.status === 422
              ? 'The service refused this change. Check the reason and the account state.'
              : 'The change was not confirmed. The account keeps its previous setting.',
      );
    } finally {
      setBusy(false);
    }
  }

  const rows = executionRows(accounts.data).rows;

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Filters" description="Find accounts by venue, environment, state or label.">
        <form
          onSubmit={(event) => event.preventDefault()}
          aria-label="Filter exchange accounts"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: theme.space(3), alignItems: 'end' }}
        >
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Venue
            <input value={query.venue ?? ''} onChange={(event) => setQuery((current) => ({ ...current, venue: event.target.value || undefined }))} disabled={accounts.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Environment
            <select value={query.environment ?? ''} onChange={(event) => setQuery((current) => ({ ...current, environment: event.target.value || undefined }))} disabled={accounts.loading}>
              <option value="">All</option>
              {['LIVE', 'TESTNET', 'PAPER'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Status
            <input value={query.status ?? ''} onChange={(event) => setQuery((current) => ({ ...current, status: event.target.value || undefined }))} disabled={accounts.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Search
            <input value={query.search ?? ''} onChange={(event) => setQuery((current) => ({ ...current, search: event.target.value || undefined }))} disabled={accounts.loading} />
          </label>
          <button type="button" disabled={accounts.loading} onClick={() => setVersion((current) => current + 1)}>Refresh</button>
        </form>
      </Card>

      <Card title="Exchange accounts" description="Connectivity and switches. Secrets are never displayed or entered here.">
        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: `0 0 ${theme.space(3)}`, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
        {error && <ErrorNotice title="Change not applied" message={error} />}
        {accounts.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading accounts…</p>}
        {accounts.error && <ErrorNotice title="Accounts unavailable" message={accounts.error} />}
        {accounts.data && rows.length === 0 && <EmptyState title="No exchange accounts" description="Accounts appear here once a key pair is registered." />}

        {accounts.data && rows.length > 0 && (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            emptyTitle="No accounts"
            columns={[
              { key: 'label', header: 'Account', render: (row) => (<span><strong style={{ fontSize: 13 }}>{row.label ?? row.venue}</strong><br /><code style={{ fontSize: 12, color: theme.color.textMuted }}>{row.id.slice(0, 8)}</code></span>) },
              { key: 'venue', header: 'Venue', render: (row) => `${row.venue} · ${row.environment}` },
              { key: 'status', header: 'Status', render: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
              { key: 'enabled', header: 'Enabled', render: (row) => <Badge tone={row.enabled ? 'success' : 'neutral'}>{row.enabled ? 'Enabled' : 'Disabled'}</Badge> },
              { key: 'live', header: 'Live trading', render: (row) => <Badge tone={row.liveTradingEnabled ? 'danger' : 'neutral'}>{row.liveTradingEnabled ? 'LIVE' : 'Off'}</Badge> },
              { key: 'verified', header: 'Verified', render: (row) => formatRelative(row.lastVerifiedAt ?? row.permissionsVerifiedAt) },
              { key: 'updated', header: 'Updated', render: (row) => formatDateTime(row.updatedAt ?? row.createdAt) },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) => (
                  <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
                    <button type="button" disabled={busy} onClick={() => setSelected(row)}>Details</button>
                    <button type="button" disabled={busy} onClick={() => void runSimple(row, 'verify')}>Verify</button>
                    <button type="button" disabled={busy} onClick={() => void runSimple(row, 'resync')}>Resync stream</button>
                    <button type="button" disabled={busy} onClick={() => { setSwitching({ account: row, op: 'enabled', next: !row.enabled }); setForm({ reason: '', confirmation: '' }); setError(''); setMessage(''); }}>
                      {row.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => { setSwitching({ account: row, op: 'liveTrading', next: !row.liveTradingEnabled }); setForm({ reason: '', confirmation: '' }); setError(''); setMessage(''); }}>
                      {row.liveTradingEnabled ? 'Stop live trading' : 'Enable live trading'}
                    </button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      {switching && (
        <Card
          title={
            switching.op === 'liveTrading'
              ? `${switching.next ? 'Enable' : 'Disable'} live trading on ${switching.account.label ?? switching.account.venue}`
              : `${switching.next ? 'Enable' : 'Disable'} ${switching.op === 'enabled' ? 'account' : 'private stream'} on ${switching.account.label ?? switching.account.venue}`
          }
          description={
            switching.op === 'liveTrading' && switching.next
              ? 'After this, orders on this account can reach the real venue and move real funds. Type the confirmation phrase exactly.'
              : 'A reason is required and is recorded with the change.'
          }
        >
          <form onSubmit={(event) => void applySwitch(event)} aria-label="Change an account setting" style={{ display: 'grid', gap: theme.space(3), maxWidth: 520 }}>
            {switching.op === 'liveTrading' && switching.next && (
              <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                Type {LIVE_TRADING_CONFIRMATION} to confirm
                <input required value={form.confirmation} onChange={(event) => setForm((current) => ({ ...current, confirmation: event.target.value }))} disabled={busy} />
              </label>
            )}
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Reason
              <textarea required rows={3} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} disabled={busy} />
            </label>
            <div style={{ display: 'flex', gap: theme.space(2) }}>
              <button type="submit" disabled={busy}>{busy ? 'Applying…' : 'Confirm'}</button>
              <button type="button" disabled={busy} onClick={() => { setSwitching(null); setError(''); }}>Cancel</button>
            </div>
          </form>
        </Card>
      )}

      {selected && <AccountDetail account={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Connectivity, balances and stream sessions for one account. Read-only by design. */
function AccountDetail({ account, onClose }: { account: ExchangeAccount; onClose: () => void }): JSX.Element {
  const connectivity = useResource(() => executionOrdersAdminApi.getConnectivity(account.id), [account.id], { errorMessage: 'Connectivity could not be checked.' });
  const balances = useResource(() => executionOrdersAdminApi.listBalances(account.id), [account.id], { errorMessage: 'Balances could not be loaded.' });
  const sessions = useResource(() => executionOrdersAdminApi.listStreamSessions(account.id), [account.id], { errorMessage: 'Stream sessions could not be loaded.' });

  return (
    <Card title={`${account.label ?? account.venue} · details`} description="Connectivity, balances and private-stream sessions for this account." actions={<button type="button" onClick={onClose}>Close</button>}>
      {connectivity.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Checking connectivity…</p>}
      {connectivity.error && <ErrorNotice title="Connectivity unknown" message={connectivity.error} />}
      {connectivity.data && (
        <p style={{ marginTop: 0, fontSize: 13 }}>
          <Badge tone={connectivity.data.reachable ? 'success' : 'danger'}>{connectivity.data.reachable ? 'Reachable' : 'Unreachable'}</Badge>{' '}
          {connectivity.data.latencyMs === null ? 'Latency not measured' : `${connectivity.data.latencyMs} ms`} · checked {formatRelative(connectivity.data.checkedAt)}
          {connectivity.data.reason ? ` · ${connectivity.data.reason}` : ''}
        </p>
      )}

      <h3 style={{ fontSize: 14, margin: `${theme.space(4)} 0 ${theme.space(3)}` }}>Balances</h3>
      {balances.error && <ErrorNotice title="Balances unavailable" message={balances.error} />}
      {balances.data && (
        <DataTable
          rows={executionRows<AccountBalance>(balances.data).rows}
          rowKey={(row) => row.asset}
          emptyTitle="No balances"
          emptyDescription="The venue reported no asset balances for this account."
          columns={[
            { key: 'asset', header: 'Asset', render: (row) => row.asset },
            { key: 'available', header: 'Available', align: 'right', render: (row) => formatAmount(row.available) },
            { key: 'locked', header: 'Locked', align: 'right', render: (row) => formatAmount(row.locked) },
            { key: 'total', header: 'Total', align: 'right', render: (row) => formatAmount(row.total) },
            { key: 'observed', header: 'Observed', render: (row) => (row.observedAt ? formatDateTime(row.observedAt) : '—') },
          ]}
        />
      )}

      <h3 style={{ fontSize: 14, margin: `${theme.space(5)} 0 ${theme.space(3)}` }}>Stream sessions</h3>
      {sessions.error && <ErrorNotice title="Stream sessions unavailable" message={sessions.error} />}
      {sessions.data && (
        <DataTable
          rows={executionRows(sessions.data).rows}
          rowKey={(row) => row.id}
          emptyTitle="No stream sessions"
          columns={[
            { key: 'status', header: 'Status', render: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
            { key: 'heartbeat', header: 'Heartbeat', render: (row) => (row.lastHeartbeatAt ? formatRelative(row.lastHeartbeatAt) : 'Never seen') },
            { key: 'expires', header: 'Expires', render: (row) => (row.expiresAt ? formatDateTime(row.expiresAt) : '—') },
          ]}
        />
      )}
    </Card>
  );
}
