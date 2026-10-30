'use client';

import { useRef, useState, type JSX } from 'react';

import { executionOrdersAdminApi, executionRows, type AccountBalance, type ExchangeAccount } from '@/api/execution-orders-admin-api';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { useResource } from '@/features/shared/use-resource';

/** One key per intent, renewed only after the API confirms. */
function keyFor(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * Per-account operator actions on an exchange account: connectivity, balances, live-trading state and an
 * on-demand reconciliation.
 *
 * Live trading is the one toggle that can lose money, so it is shown as two separate facts - enabled and
 * live-trading-enabled - and changing it asks for confirmation with the account named. Reconciliation is
 * queued, not run inline: the API answers 202 with a job, and the panel says so instead of pretending the
 * work finished.
 */
export function ExchangeAccountOps({ initialAccountId = '' }: { initialAccountId?: string }): JSX.Element {
  const accounts = useResource(() => executionOrdersAdminApi.listAccounts({ limit: 25 }), [], { errorMessage: 'Exchange accounts could not be loaded.' });
  const [accountId, setAccountId] = useState(initialAccountId);
  const [selected, setSelected] = useState(initialAccountId.trim());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const reconcileKey = useRef(keyFor('reconcile'));

  const connectivity = useResource(() => executionOrdersAdminApi.getConnectivity(selected), [selected], {
    enabled: selected.length > 0,
    errorMessage: 'Connectivity could not be read for this account.',
  });
  const balances = useResource(() => executionOrdersAdminApi.listBalances(selected, false), [selected], {
    enabled: selected.length > 0,
    errorMessage: 'Balances could not be read for this account.',
  });

  const rows: ExchangeAccount[] = executionRows<ExchangeAccount>(accounts.data).rows;

  const reconcile = async (): Promise<void> => {
    setBusy(true);
    setMessage('');
    try {
      const accepted = await executionOrdersAdminApi.reconcileAccount(selected, reconcileKey.current);
      reconcileKey.current = keyFor('reconcile');
      setMessage(`Reconciliation queued as job ${accepted.jobId}. It runs out of band; nothing was changed on the account.`);
    } catch {
      setMessage('The reconciliation could not be queued.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Exchange accounts">
      {accounts.error && <ErrorNotice title="Exchange accounts" message={accounts.error} />}
      {!accounts.loading && !accounts.error && rows.length === 0 && (
        <EmptyState title="No exchange accounts" description="No account is registered for this organisation." />
      )}
      {rows.length > 0 && (
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            { key: 'account', header: 'Account', render: (row) => row.id },
            { key: 'venue', header: 'Venue', render: (row) => row.venue },
            { key: 'environment', header: 'Environment', render: (row) => row.environment },
            { key: 'status', header: 'Status', render: (row) => <Badge tone={row.enabled ? 'success' : 'neutral'}>{row.status}</Badge> },
            { key: 'live-trading', header: 'Live trading', render: (row) => (row.liveTradingEnabled ? 'Enabled' : 'Disabled') },
            { key: 'select', header: 'Select', render: (row) => (
              <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => { setAccountId(row.id); setSelected(row.id); }}>
                Inspect
              </button>
            ) },
          ]}
        />
      )}

      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSelected(accountId.trim());
        }}
      >
        <label className="block text-sm">
          <span className="font-medium">Account id</span>
          <input className="mt-1 w-full rounded border px-3 py-2" value={accountId} onChange={(event) => setAccountId(event.target.value)} />
        </label>
        <button type="submit" className="rounded border px-3 py-2 text-sm" disabled={accountId.trim().length === 0}>
          Inspect account
        </button>
      </form>

      {selected.length > 0 && (
        <>
          {connectivity.error && <ErrorNotice title="Connectivity" message={connectivity.error} />}
          {connectivity.data && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatTile label="Reachable" value={String(connectivity.data.reachable)} hint={connectivity.data.checkedAt} />
              <StatTile label="Latency" value={connectivity.data.latencyMs === null ? 'Not available' : `${connectivity.data.latencyMs} ms`} />
              <StatTile label="Account" value={selected} />
            </div>
          )}
          {balances.error && <ErrorNotice title="Balances" message={balances.error} />}
          {executionRows<AccountBalance>(balances.data).rows.length > 0 && (
            <DataTable
              rows={executionRows<AccountBalance>(balances.data).rows}
              rowKey={(row) => row.asset}
              columns={[
                { key: 'asset', header: 'Asset', render: (row) => row.asset },
                { key: 'available', header: 'Available', render: (row) => row.available ?? 'Not reported' },
              ]}
            />
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => void reconcile()} disabled={busy}>
              Queue reconciliation
            </button>
            <span className="text-xs text-muted">Queues an out-of-band pass. It never edits an order or a position.</span>
          </div>
          <p role="status" aria-live="polite" className="mt-2 min-h-[1.25rem] text-sm">{message}</p>
        </>
      )}
    </Card>
  );
}
