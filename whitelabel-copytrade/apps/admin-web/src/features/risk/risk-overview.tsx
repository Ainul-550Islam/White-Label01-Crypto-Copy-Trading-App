'use client';

import { useState, type JSX } from 'react';

import { riskAdminApi, riskRows, type RiskSwitch } from '@/api/risk-admin-api';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * The risk dashboard: one screen over the risk-management reads, plus the
 * kill-switch controls.
 *
 * Two properties are preserved from the API's own design:
 *
 *  * A metric the service could not compute arrives as null. It is rendered as
 *    "Not available", never as zero, because a zero VaR and an unmeasured VaR
 *    are very different facts on a risk screen.
 *  * Clearing a switch is not offered here. The `risk` controller requires the
 *    typed phrase `CLEAR RISK PROTECTION` plus a 20-character reason, which the
 *    dedicated risk page performs; duplicating it without that ceremony would
 *    be a weaker control than the API intends.
 */
export function RiskOverview({ accountId }: { accountId: string }): JSX.Element {
  const scope = accountId.trim() ? { accountId: accountId.trim() } : {};

  const dashboard = useResource(() => riskAdminApi.getDashboard(scope), [accountId], { errorMessage: 'The risk dashboard could not be loaded.' });
  const exposure = useResource(() => riskAdminApi.getExposure(accountId.trim() || undefined), [accountId], { errorMessage: 'Exposure could not be loaded.' });
  const drawdown = useResource(() => riskAdminApi.getDrawdown(scope), [accountId], { errorMessage: 'Drawdown could not be loaded.' });
  const dailyLoss = useResource(() => riskAdminApi.getDailyLoss(accountId.trim() || undefined), [accountId], { errorMessage: 'Daily loss could not be loaded.' });
  const varView = useResource(() => riskAdminApi.getVar(accountId.trim() || undefined), [accountId], { errorMessage: 'Value at risk could not be loaded.' });
  const concentration = useResource(() => riskAdminApi.getConcentration(accountId.trim() || undefined), [accountId], { errorMessage: 'Concentration could not be loaded.' });
  const stress = useResource(() => riskAdminApi.getStress(accountId.trim() || undefined), [accountId], { errorMessage: 'Stress scenarios could not be loaded.' });
  const events = useResource(() => riskAdminApi.getEvents(accountId.trim() ? { accountId: accountId.trim() } : {}), [accountId], { errorMessage: 'Risk events could not be loaded.' });

  const [switchesVersion, setSwitchesVersion] = useState(0);
  const switches = useResource(() => riskAdminApi.listSwitches({}), [switchesVersion], { errorMessage: 'Kill switches could not be loaded.' });
  const [form, setForm] = useState({ scope: 'ACCOUNT', target: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function engage(): Promise<void> {
    if (form.reason.trim().length < 5) {
      setError('Give a reason of at least five characters; it is stored with the switch.');
      return;
    }
    if (form.scope !== 'GLOBAL' && form.target.trim() === '') {
      setError('Give the target the switch applies to (an account, strategy or symbol id).');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await riskAdminApi.engageSwitch(
        { scope: form.scope, reason: form.reason.trim(), ...(form.target.trim() ? { target: form.target.trim() } : {}) },
        crypto.randomUUID(),
      );
      setMessage('The kill switch was engaged. New risk-increasing orders in scope are refused immediately.');
      setForm({ scope: 'ACCOUNT', target: '', reason: '' });
      setSwitchesVersion((value) => value + 1);
    } catch {
      setError('The kill switch was not engaged. The previous state is unchanged.');
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(item: RiskSwitch): Promise<void> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await riskAdminApi.acknowledgeSwitch(item.id, 'Acknowledged from the risk dashboard', crypto.randomUUID());
      setMessage('The switch was acknowledged.');
      setSwitchesVersion((value) => value + 1);
    } catch {
      setError('The acknowledgement was not recorded.');
    } finally {
      setBusy(false);
    }
  }

  const switches_ = riskRows(switches.data);

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Risk posture" description="Aggregated by the risk service. An unavailable figure is shown as unavailable, never as zero.">
        {dashboard.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading risk posture…</p>}
        {dashboard.error && <ErrorNotice title="Risk dashboard unavailable" message={dashboard.error} />}
        {dashboard.data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: theme.space(3) }}>
              <StatTile label="Total exposure" value={formatAmount(exposure.data?.totalExposure ?? null)} />
              <StatTile label="Net exposure" value={formatAmount(exposure.data?.netExposure ?? null)} />
              <StatTile label="Current drawdown" value={formatAmount(drawdown.data?.currentDrawdown ?? null)} hint={drawdown.data?.limitBreached ? 'Limit breached' : undefined} />
              <StatTile label="Daily loss remaining" value={formatAmount(dailyLoss.data?.remaining ?? null)} hint={dailyLoss.data?.breached ? 'Daily loss limit breached' : 'Within limit'} />
              <StatTile label="Value at risk" value={formatAmount(varView.data?.var ?? null)} hint={varView.data?.confidence ? `${varView.data.confidence} confidence` : undefined} />
              <StatTile label="Worst stress case" value={formatAmount(stress.data?.worstCase ?? null)} />
            </div>
            <p style={{ margin: `${theme.space(3)} 0 0`, fontSize: 12, color: theme.color.textMuted }}>
              Reported at {formatDateTime(dashboard.data.asOf)}
              {dashboard.data.dataCompleteness ? ` · completeness ${dashboard.data.dataCompleteness}` : ''}
            </p>
          </>
        )}
      </Card>

      <Card title="Concentration by symbol" description="Share of exposure per symbol, with the venue split when the service returns it.">
        {concentration.error && <ErrorNotice title="Concentration unavailable" message={concentration.error} />}
        {concentration.data && (
          <DataTable
            rows={concentration.data.bySymbol ?? []}
            rowKey={(row) => row.symbol}
            emptyTitle="No concentration to show"
            emptyDescription="The account holds no open exposure."
            columns={[
              { key: 'symbol', header: 'Symbol', render: (row) => row.symbol },
              { key: 'exposure', header: 'Exposure', align: 'right', render: (row) => formatAmount(row.exposure) },
              // Basis points are an integer; the percentage is formatted by integer arithmetic so no
              // float ever touches a figure an operator reads as a share of exposure.
              {
                key: 'share',
                header: 'Share',
                align: 'right',
                render: (row) =>
                  row.shareBps === null
                    ? 'Not available'
                    : `${Math.floor(row.shareBps / 100)}.${String(row.shareBps % 100).padStart(2, '0')}%`,
              },
            ]}
          />
        )}
      </Card>

      <Card title="Stress scenarios" description="Loss under each scenario the service evaluates.">
        {stress.error && <ErrorNotice title="Stress scenarios unavailable" message={stress.error} />}
        {stress.data && (
          <DataTable
            rows={stress.data.scenarios ?? []}
            rowKey={(row) => row.name}
            emptyTitle="No stress scenarios returned"
            columns={[
              { key: 'name', header: 'Scenario', render: (row) => row.name },
              { key: 'description', header: 'Description', render: (row) => row.description ?? '—' },
              { key: 'loss', header: 'Loss', align: 'right', render: (row) => formatAmount(row.loss) },
            ]}
          />
        )}
      </Card>

      <Card title="Risk events" description="Decisions, protections and sync faults recorded by the risk engine.">
        {events.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading events…</p>}
        {events.error && <ErrorNotice title="Risk events unavailable" message={events.error} />}
        {events.data && (
          <DataTable
            rows={riskRows(events.data)}
            rowKey={(row) => row.id}
            emptyTitle="No risk events"
            emptyDescription="The engine has not recorded a decision or protection action for this scope."
            columns={[
              { key: 'severity', header: 'Severity', render: (row) => <Badge tone={toneForStatus(row.severity)}>{row.severity}</Badge> },
              { key: 'type', header: 'Event', render: (row) => row.eventType ?? '—' },
              { key: 'rule', header: 'Rule', render: (row) => row.ruleId ?? '—' },
              { key: 'summary', header: 'Summary', render: (row) => row.summary ?? '—' },
              { key: 'at', header: 'At', render: (row) => formatDateTime(row.createdAt) },
            ]}
          />
        )}
      </Card>

      <Card title="Kill switches" description="Engaging a switch refuses every risk-increasing order in scope on the engine's next sync. Clearing one needs the dedicated risk page.">
        <p role="status" aria-live="polite" style={{ marginTop: 0, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
        {error && <ErrorNotice title="Switch action not completed" message={error} />}

        <form onSubmit={(event) => { event.preventDefault(); void engage(); }} aria-label="Engage a kill switch" style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: theme.space(5) }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Scope
            <select value={form.scope} onChange={(event) => setForm((current) => ({ ...current, scope: event.target.value }))} disabled={busy}>
              {['GLOBAL', 'ACCOUNT', 'STRATEGY', 'SYMBOL'].map((scopeValue) => <option key={scopeValue} value={scopeValue}>{scopeValue}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 220 }}>
            Target {form.scope === 'GLOBAL' ? '(not needed)' : ''}
            <input value={form.target} onChange={(event) => setForm((current) => ({ ...current, target: event.target.value }))} disabled={busy || form.scope === 'GLOBAL'} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 260 }}>
            Reason
            <input required value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} disabled={busy} />
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Engaging…' : 'Engage switch'}</button>
        </form>

        {switches.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading switches…</p>}
        {switches.error && <ErrorNotice title="Kill switches unavailable" message={switches.error} />}
        {switches.data && (
          <DataTable
            rows={switches_}
            rowKey={(row) => row.id}
            emptyTitle="No kill switches"
            emptyDescription="Nothing is currently engaged for this organisation."
            columns={[
              { key: 'scope', header: 'Scope', render: (row) => `${row.scope}${row.target ? ` · ${row.target}` : ''}` },
              { key: 'status', header: 'Status', render: (row) => <Badge tone={row.engaged ? 'danger' : 'neutral'}>{row.status}</Badge> },
              { key: 'reason', header: 'Reason', render: (row) => row.reason ?? '—' },
              { key: 'at', header: 'Engaged', render: (row) => formatDateTime(row.engagedAt ?? row.createdAt) },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) =>
                  row.status === 'TRIGGERED' ? (
                    <button type="button" disabled={busy} onClick={() => void acknowledge(row)}>Acknowledge</button>
                  ) : (
                    <span style={{ color: theme.color.textMuted }}>—</span>
                  ),
              },
            ]}
          />
        )}
        {switches.data && switches_.length === 0 && <EmptyState title="Nothing engaged" description="Engaging a switch above will list it here." />}
      </Card>
    </div>
  );
}
