'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import { exchangeAdminApi, exchangeRows, type ConnectivityCheck, type ExchangeHealthRow, type RoutingDecision } from '@/api/exchange-admin-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { useResource } from '@/features/shared/use-resource';

/**
 * Exchange operations: per-account health, connectivity and capability checks,
 * the three sync commands, and the routing decision.
 *
 * Two rules shape this screen:
 *
 *  * A health field the service did not measure arrives as null. It is printed
 *    as "not measured" and the row says `dataCompleteness: UNKNOWN`, because an
 *    unmeasured auth-failure counter is not the same as zero auth failures.
 *  * The routing decision is a query, not an action: it is shown with the
 *    service's own reason and the live-gate blocking reasons, so an operator can
 *    see why an account was not selected without triggering anything.
 */
const ENVIRONMENTS = ['LIVE', 'TESTNET', 'PAPER'] as const;
const OPERATIONS = ['READ', 'MARKET_DATA', 'TRADE', 'WITHDRAWAL'] as const;

function measured(value: number | null, suffix = ''): string {
  return value === null || value === undefined ? 'Not measured' : `${value}${suffix}`;
}

export function ExchangeOperationsPanel(): JSX.Element {
  const [version, setVersion] = useState(0);
  const health = useResource(() => exchangeAdminApi.listHealth(), [version], { errorMessage: 'Exchange health could not be loaded.' });
  const venues = useResource(() => exchangeAdminApi.listRegistryVenues(), [version], { errorMessage: 'The venue registry could not be loaded.' });
  const symbols = useResource(() => exchangeAdminApi.listSymbols({ limit: 25 }), [version], { errorMessage: 'Symbols could not be loaded.' });

  const [accountId, setAccountId] = useState('');
  const [environment, setEnvironment] = useState<string>('LIVE');
  const [connectivity, setConnectivity] = useState<ConnectivityCheck | null>(null);
  const [routing, setRouting] = useState<RoutingDecision | null>(null);
  const [routingForm, setRoutingForm] = useState<{ requiredCapability: string; operation: string }>({ requiredCapability: 'SPOT', operation: 'MARKET_DATA' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  async function run(op: 'connectivity' | 'capabilities' | 'health' | 'syncBalances' | 'syncPositions' | 'syncOrders' | 'syncSymbols'): Promise<void> {
    const id = accountId.trim();
    if (id === '') {
      setError('Enter the exchange account id first.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (op === 'connectivity') {
        const result = await exchangeAdminApi.checkConnectivity({ accountId: id, environment }, crypto.randomUUID());
        setConnectivity(result);
        setMessage(result.connected ? 'The venue answered.' : `No connection: ${result.failureReason ?? result.state}.`);
      } else if (op === 'capabilities') {
        const result = await exchangeAdminApi.discoverCapabilities(id, crypto.randomUUID());
        setConnectivity(result);
        setMessage(`Capabilities discovered: ${result.capabilities.join(', ') || 'none reported'}.`);
      } else if (op === 'health') {
        const result = await exchangeAdminApi.checkHealth(id, crypto.randomUUID());
        setMessage(`Health check finished: ${result.state}.`);
      } else if (op === 'syncOrders') {
        await exchangeAdminApi.syncOrders({ accountId: id, environment }, crypto.randomUUID());
        setMessage('An order sync was requested. Order state refreshes when the venue answers.');
      } else if (op === 'syncSymbols') {
        await exchangeAdminApi.syncSymbols(id, crypto.randomUUID());
        setMessage('Symbol metadata sync requested for the account.');
      } else if (op === 'syncBalances') {
        await exchangeAdminApi.syncBalances({ accountId: id, environment }, crypto.randomUUID());
        setMessage('A balance sync was requested.');
      } else {
        await exchangeAdminApi.syncPositions({ accountId: id, environment }, crypto.randomUUID());
        setMessage('A position sync was requested.');
      }
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 400
          ? 'The service refused the request: check the account id and the environment.'
          : caught instanceof ApiError && caught.status === 503
            ? 'This account cannot be enabled without a live-trading request; the service refused to pretend otherwise.'
            : 'The request was not completed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function enableLive(): Promise<void> {
    const id = accountId.trim();
    if (id === '') {
      setError('Enter the exchange account id first.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const account = await exchangeAdminApi.enableAccount(id, { liveTradingRequested: true }, crypto.randomUUID());
      setMessage(`Live trading is now armed for ${account.accountId.slice(0, 8)}. Orders can reach the real venue.`);
      setVersion((current) => current + 1);
    } catch {
      setError('The account was not armed. Nothing changed.');
    } finally {
      setBusy(false);
    }
  }

  async function decide(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await exchangeAdminApi.decideRouting(
        {
          requiredCapability: routingForm.requiredCapability,
          operation: routingForm.operation as (typeof OPERATIONS)[number],
          environment,
          ...(accountId.trim() ? { accountId: accountId.trim() } : {}),
        },
        crypto.randomUUID(),
      );
      setRouting(result);
    } catch {
      setError('The routing decision could not be evaluated.');
    } finally {
      setBusy(false);
    }
  }

  const rows = exchangeRows<ExchangeHealthRow>({ data: health.data ?? [] } as { data: ExchangeHealthRow[] });
  const unmeasured = rows.filter((row) => row.dataCompleteness === 'UNKNOWN').length;

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Account" description="Checks and syncs act on one account. Enter its id once and use the buttons below.">
        <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 300 }}>
            Exchange account id
            <input value={accountId} onChange={(event) => setAccountId(event.target.value)} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Environment
            <select value={environment} onChange={(event) => setEnvironment(event.target.value)} disabled={busy}>
              {ENVIRONMENTS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap', marginTop: theme.space(4) }}>
          <button type="button" disabled={busy} onClick={() => void run('connectivity')}>Check connectivity</button>
          <button type="button" disabled={busy} onClick={() => void run('capabilities')}>Discover capabilities</button>
          <button type="button" disabled={busy} onClick={() => void run('health')}>Re-check health</button>
          <button type="button" disabled={busy} onClick={() => void run('syncBalances')}>Sync balances</button>
          <button type="button" disabled={busy} onClick={() => void run('syncPositions')}>Sync positions</button>
          <button type="button" disabled={busy} onClick={() => void run('syncOrders')}>Sync orders</button>
          <button type="button" disabled={busy} onClick={() => void run('syncSymbols')}>Sync symbols</button>
          <button type="button" disabled={busy} onClick={() => void enableLive()}>Arm live trading</button>
        </div>

        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: `${theme.space(3)} 0 0`, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
        {error && <ErrorNotice title="Request not completed" message={error} />}

        {connectivity && (
          <div style={{ marginTop: theme.space(4) }}>
            <p style={{ margin: `0 0 ${theme.space(2)}`, fontSize: 13 }}>
              <Badge tone={connectivity.connected ? 'success' : connectivity.degraded ? 'warning' : 'danger'}>
                {connectivity.connected ? 'Connected' : connectivity.degraded ? 'Degraded' : connectivity.state}
              </Badge>{' '}
              {measured(connectivity.latencyMs, ' ms')} · {connectivity.environment}
              {connectivity.isSimulated ? ' · simulated venue' : ''}
              {connectivity.failureReason ? ` · ${connectivity.failureReason}` : ''}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: theme.color.textMuted }}>
              Capabilities: {connectivity.capabilities.join(', ') || 'none reported'} · clock drift{' '}
              {connectivity.clockDriftMs === null ? 'not measured' : `${connectivity.clockDriftMs} ms`}
            </p>
          </div>
        )}
      </Card>

      <Card title="Account health" description="Measured latency, error and rate-limit pressure per account. Unmeasured counters are labelled, not zeroed.">
        <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', marginBottom: theme.space(4) }}>
          <StatTile label="Accounts" value={rows.length} />
          <StatTile label="Incomplete telemetry" value={unmeasured} hint={unmeasured > 0 ? 'Some counters were not observed' : 'All observed'} />
          <StatTile label="Credentials expired" value={rows.filter((row) => row.credentialExpired).length} />
        </div>

        {health.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading health…</p>}
        {health.error && <ErrorNotice title="Health unavailable" message={health.error} />}
        {health.data && rows.length === 0 && <EmptyState title="No exchange accounts" description="Connect an account before checking health." />}

        {rows.length > 0 && (
          <DataTable
            rows={rows}
            rowKey={(row) => row.accountId}
            emptyTitle="No accounts"
            columns={[
              { key: 'account', header: 'Account', render: (row) => <code style={{ fontSize: 12 }}>{String(row.accountId).slice(0, 8)}</code> },
              { key: 'venue', header: 'Venue', render: (row) => `${row.venue} · ${row.environment}` },
              { key: 'state', header: 'State', render: (row) => <Badge tone={toneForStatus(row.state)}>{row.state}</Badge> },
              { key: 'latency', header: 'Latency', align: 'right', render: (row) => measured(row.latencyMs, ' ms') },
              { key: 'auth', header: 'Auth failures', align: 'right', render: (row) => measured(row.authFailures) },
              { key: 'rate', header: 'Rate pressure', align: 'right', render: (row) => measured(row.rateLimitPressure) },
              { key: 'sync', header: 'Sync age', align: 'right', render: (row) => (row.syncAgeMs === null ? 'Not measured' : `${Math.round(row.syncAgeMs / 1000)}s`) },
              { key: 'completeness', header: 'Telemetry', render: (row) => <Badge tone={row.dataCompleteness === 'OBSERVED' ? 'success' : 'warning'}>{row.dataCompleteness}</Badge> },
              { key: 'checked', header: 'Checked', render: (row) => formatRelative(row.lastCheckedAt) },
              { key: 'error', header: 'Last error', render: (row) => row.lastErrorCode ?? '—' },
            ]}
          />
        )}
      </Card>

      <Card title="Routing decision" description="Which account the service would pick for an operation, and why. This evaluates; it does not place anything.">
        <form onSubmit={(event) => void decide(event)} aria-label="Evaluate a routing decision" style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Required capability
            <input value={routingForm.requiredCapability} onChange={(event) => setRoutingForm((current) => ({ ...current, requiredCapability: event.target.value }))} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Operation
            <select value={routingForm.operation} onChange={(event) => setRoutingForm((current) => ({ ...current, operation: event.target.value }))} disabled={busy}>
              {OPERATIONS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Evaluating…' : 'Evaluate'}</button>
        </form>

        {routing && (
          <div style={{ marginTop: theme.space(4), fontSize: 13 }}>
            <p style={{ margin: `0 0 ${theme.space(2)}` }}>
              <Badge tone={routing.selectedAccountId ? 'success' : 'warning'}>{routing.selectedAccountId ? 'Selected' : 'No eligible account'}</Badge>{' '}
              {routing.routingReason}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: theme.color.textMuted }}>
              Eligible: {routing.eligibleAccounts.length} account(s) · live execution {routing.liveExecutionPermitted ? 'permitted' : 'blocked'}
              {routing.liveGateBlockingReasons.length > 0 ? ` (${routing.liveGateBlockingReasons.join(', ')})` : ''} · compliance{' '}
              {routing.complianceAllowed ? 'allowed' : 'refused'} · risk {routing.riskAllowed ? 'allowed' : 'refused'}
            </p>
          </div>
        )}
      </Card>

      <Card title="Venue registry" description="What each venue declares it supports. The console reads this; it never assumes a capability.">
        {venues.error && <ErrorNotice title="Registry unavailable" message={venues.error} />}
        {venues.data && (
          <DataTable
            rows={venues.data}
            rowKey={(row) => row.venue}
            emptyTitle="No venues registered"
            columns={[
              { key: 'venue', header: 'Venue', render: (row) => row.venue },
              { key: 'name', header: 'Name', render: (row) => row.displayName },
              { key: 'envs', header: 'Environments', render: (row) => row.supportedEnvironments.join(', ') },
              { key: 'caps', header: 'Capabilities', render: (row) => row.supportedCapabilities.join(', ') },
              { key: 'types', header: 'Order types', render: (row) => row.supportedOrderTypes.join(', ') },
              { key: 'ws', header: 'Streams', render: (row) => (row.websocketAvailable ? 'Available' : 'Not available') },
              { key: 'active', header: 'Active', render: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'Yes' : 'No'}</Badge> },
            ]}
          />
        )}
      </Card>

      <Card title="Symbols" description="The tradable catalogue the platform holds, newest sync first 25.">
        {symbols.error && <ErrorNotice title="Symbols unavailable" message={symbols.error} />}
        {symbols.data && (
          <DataTable
            rows={exchangeRows(symbols.data)}
            rowKey={(row) => `${row.venue ?? ''}-${row.symbol}`}
            emptyTitle="No symbols"
            columns={[
              { key: 'symbol', header: 'Symbol', render: (row) => row.symbol },
              { key: 'venue', header: 'Venue', render: (row) => row.venue ?? '—' },
              { key: 'pair', header: 'Pair', render: (row) => (row.baseAsset && row.quoteAsset ? `${row.baseAsset}/${row.quoteAsset}` : '—') },
              { key: 'tradeable', header: 'Tradable', render: (row) => <Badge tone={row.isTradeable ? 'success' : 'neutral'}>{row.isTradeable ? 'Yes' : 'No'}</Badge> },
              { key: 'tick', header: 'Tick size', align: 'right', render: (row) => row.tickSize ?? '—' },
            ]}
          />
        )}
        <p style={{ margin: `${theme.space(3)} 0 0`, fontSize: 12, color: theme.color.textMuted }}>
          {venues.data ? `${venues.data.length} venue(s) registered` : 'Registry unavailable'} · symbol counts are the service&rsquo;s, not a local estimate.
        </p>
      </Card>
    </div>
  );
}
