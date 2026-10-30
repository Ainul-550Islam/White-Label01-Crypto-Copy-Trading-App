'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import { riskAdminApi, riskRows, type RiskSwitch } from '@/api/risk-admin-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * Circuit breakers, kill switches and automatic protections.
 *
 * Clearing a switch is the dangerous direction, so it is gated twice:
 *
 *  * the operator must type the confirmation phrase the DTO requires
 *    (`CLEAR RISK PROTECTION`), and
 *  * the reason must meet the DTO minimum length.
 *
 * Acknowledging is deliberately weaker - it records that a human has seen the
 * protection, and does not re-enable trading. The two are separate buttons so
 * nobody acknowledges and assumes risk is restored.
 */
const CLEAR_CONFIRMATION = 'CLEAR RISK PROTECTION';

type ManagedKind = 'breaker' | 'killSwitch';

export function RiskControls(): JSX.Element {
  const [version, setVersion] = useState(0);
  const breakers = useResource(() => riskAdminApi.listBreakers(), [version], { errorMessage: 'Circuit breakers could not be loaded.' });
  const killSwitches = useResource(() => riskAdminApi.listKillSwitches(), [version], { errorMessage: 'Kill switches could not be loaded.' });
  const protections = useResource(() => riskAdminApi.listProtections({ includeCleared: true }), [version], { errorMessage: 'Protections could not be loaded.' });
  const reconciliation = useResource(() => riskAdminApi.getReconciliation(), [version], { errorMessage: 'Reconciliation could not be loaded.' });
  const snapshots = useResource(() => riskAdminApi.getSnapshots(), [version], { errorMessage: 'Snapshots could not be loaded.' });

  const [action, setAction] = useState<{ kind: ManagedKind; id: string; op: 'clear' | 'acknowledge' } | null>(null);
  const [detail, setDetail] = useState({ reason: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [trigger, setTrigger] = useState({ scope: 'ACCOUNT', scopeId: '', triggerType: 'MANUAL', reason: '' });
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  async function runDetail(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!action) return;
    const reason = detail.reason.trim();
    if (reason.length < 10) {
      setError('Give a reason of at least ten characters.');
      return;
    }
    if (action.op === 'clear' && detail.confirm.trim() !== CLEAR_CONFIRMATION) {
      setError(`Type ${CLEAR_CONFIRMATION} exactly to clear.`);
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (action.kind === 'breaker') {
        if (action.op === 'clear') await riskAdminApi.clearBreaker(action.id, reason, crypto.randomUUID());
        else await riskAdminApi.acknowledgeBreaker(action.id, reason, crypto.randomUUID());
      } else if (action.op === 'clear') {
        await riskAdminApi.clearKillSwitch(action.id, reason, crypto.randomUUID());
      } else {
        await riskAdminApi.acknowledgeKillSwitch(action.id, reason, crypto.randomUUID());
      }
      setMessage(action.op === 'clear' ? 'The protection was cleared.' : 'The protection was acknowledged.');
      setAction(null);
      setDetail({ reason: '', confirm: '' });
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 403
          ? 'You do not have permission to change this protection.'
          : caught instanceof ApiError && caught.status === 409
            ? 'The protection changed since this page loaded. Reload and check its current state.'
            : 'The action was not confirmed. The protection is unchanged.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendTrigger(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (trigger.scopeId.trim() === '' || trigger.reason.trim().length < 10) {
      setError('Give the account or strategy id and a reason of at least ten characters.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await riskAdminApi.triggerBreaker(
        { scope: trigger.scope, scopeId: trigger.scopeId.trim(), triggerType: trigger.triggerType, reason: trigger.reason.trim() },
        crypto.randomUUID(),
      );
      setMessage('The breaker was triggered. In-scope new orders will be refused.');
      setTrigger({ scope: 'ACCOUNT', scopeId: '', triggerType: 'MANUAL', reason: '' });
      setVersion((current) => current + 1);
    } catch {
      setError('The breaker was not triggered.');
    } finally {
      setBusy(false);
    }
  }

  function rowActions(kind: ManagedKind, row: RiskSwitch): JSX.Element {
    const engaged = row.engaged || row.status === 'TRIGGERED' || row.status === 'ACTIVE';
    return (
      <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
        {row.status !== 'ACKNOWLEDGED' && (
          <button type="button" disabled={busy} onClick={() => { setAction({ kind, id: row.id, op: 'acknowledge' }); setError(''); setMessage(''); }}>
            Acknowledge
          </button>
        )}
        {engaged && (
          <button type="button" disabled={busy} onClick={() => { setAction({ kind, id: row.id, op: 'clear' }); setError(''); setMessage(''); }}>
            Clear
          </button>
        )}
        {!engaged && row.status === 'ACKNOWLEDGED' && <span style={{ color: theme.color.textMuted, fontSize: 13 }}>Cleared</span>}
      </div>
    );
  }

  const breakerRows = riskRows(breakers.data);
  const switchRows = riskRows(killSwitches.data);
  const protectionRows = riskRows(protections.data);
  const activeCount = [...breakerRows, ...switchRows].filter((row) => row.engaged || row.status === 'TRIGGERED' || row.status === 'ACTIVE').length;

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Protection posture" description="What the risk service is currently enforcing.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: theme.space(3) }}>
          <StatTile label="Active protections" value={activeCount} hint={activeCount > 0 ? 'Trading may be restricted' : 'Nothing engaged'} />
          <StatTile label="Recorded protections" value={protectionRows.length} />
          <StatTile
            label="Last reconciliation"
            value={reconciliation.data ? (reconciliation.data.matched === true ? 'Matched' : reconciliation.data.matched === false ? 'Discrepancies' : 'Not compared') : '—'}
            hint={reconciliation.data?.checkedAt ? formatDateTime(reconciliation.data.checkedAt) : undefined}
          />
        </div>
        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: `${theme.space(3)} 0 0`, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
        {error && <ErrorNotice title="Protection action not completed" message={error} />}
      </Card>

      {reconciliation.data && reconciliation.data.findings.length > 0 && (
        <Card title="Reconciliation findings" description="The risk engine's view differs from the venue's. Resolve these before trusting exposure figures.">
          <DataTable
            rows={reconciliation.data.findings}
            rowKey={(row, index) => String(row.id ?? row.symbol ?? index)}
            emptyTitle="No findings"
            columns={[
              { key: 'type', header: 'Finding', render: (row) => String(row.type ?? row.kind ?? '—') },
              { key: 'detail', header: 'Detail', render: (row) => String(row.message ?? row.detail ?? '—') },
            ]}
          />
        </Card>
      )}

      {action && (
        <Card
          title={action.op === 'clear' ? 'Clear this protection' : 'Acknowledge this protection'}
          description={
            action.op === 'clear'
              ? 'Clearing re-enables the trading this protection was blocking. It needs a typed confirmation and a reason.'
              : 'Acknowledging records that a human has seen this protection. It does not re-enable trading.'
          }
        >
          <form onSubmit={(event) => void runDetail(event)} aria-label={action.op === 'clear' ? 'Clear a protection' : 'Acknowledge a protection'} style={{ display: 'grid', gap: theme.space(3), maxWidth: 520 }}>
            {action.op === 'clear' && (
              <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                Type {CLEAR_CONFIRMATION} to confirm
                <input required value={detail.confirm} onChange={(event) => setDetail((current) => ({ ...current, confirm: event.target.value }))} disabled={busy} />
              </label>
            )}
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Reason
              <textarea required rows={3} value={detail.reason} onChange={(event) => setDetail((current) => ({ ...current, reason: event.target.value }))} disabled={busy} />
            </label>
            <div style={{ display: 'flex', gap: theme.space(2) }}>
              <button type="submit" disabled={busy}>{busy ? 'Sending…' : action.op === 'clear' ? 'Confirm clear' : 'Confirm acknowledge'}</button>
              <button type="button" disabled={busy} onClick={() => { setAction(null); setError(''); setDetail({ reason: '', confirm: '' }); }}>Cancel</button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Circuit breakers" description="Automatic and manual breakers with their trigger source and reason.">
        {breakers.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading breakers…</p>}
        {breakers.error && <ErrorNotice title="Breakers unavailable" message={breakers.error} />}
        {breakers.data && (
          <DataTable
            rows={breakerRows}
            rowKey={(row) => row.id}
            emptyTitle="No circuit breakers"
            emptyDescription="Nothing has tripped for this organisation."
            columns={[
              { key: 'scope', header: 'Scope', render: (row) => `${row.scope}${row.scopeId ? ` · ${row.scopeId}` : ''}` },
              { key: 'status', header: 'Status', render: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
              { key: 'trigger', header: 'Trigger', render: (row) => row.triggerType ?? '—' },
              { key: 'rule', header: 'Rule', render: (row) => row.triggeredByRule ?? '—' },
              { key: 'reason', header: 'Reason', render: (row) => row.reason ?? '—' },
              { key: 'at', header: 'Raised', render: (row) => formatDateTime(row.createdAt) },
              { key: 'actions', header: 'Actions', render: (row) => rowActions('breaker', row) },
            ]}
          />
        )}
      </Card>

      <Card title="Trigger a breaker" description="Use when you need to stop new risk for one account or strategy immediately.">
        <form onSubmit={(event) => void sendTrigger(event)} aria-label="Trigger a circuit breaker" style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Scope
            <select value={trigger.scope} onChange={(event) => setTrigger((current) => ({ ...current, scope: event.target.value }))} disabled={busy}>
              {['ACCOUNT', 'STRATEGY', 'TRADER'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 220 }}>
            Scope id
            <input required value={trigger.scopeId} onChange={(event) => setTrigger((current) => ({ ...current, scopeId: event.target.value }))} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Trigger type
            <select value={trigger.triggerType} onChange={(event) => setTrigger((current) => ({ ...current, triggerType: event.target.value }))} disabled={busy}>
              {['MANUAL', 'LOSS_LIMIT', 'DRAWDOWN', 'EXPOSURE', 'RECONCILIATION'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 280 }}>
            Reason
            <input required value={trigger.reason} onChange={(event) => setTrigger((current) => ({ ...current, reason: event.target.value }))} disabled={busy} />
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Triggering…' : 'Trigger breaker'}</button>
        </form>
      </Card>

      <Card title="Kill switches" description="Organisation-wide or scoped stops. Clearing one requires the typed confirmation above.">
        {killSwitches.error && <ErrorNotice title="Kill switches unavailable" message={killSwitches.error} />}
        {killSwitches.data && (
          <DataTable
            rows={switchRows}
            rowKey={(row) => row.id}
            emptyTitle="No kill switches"
            emptyDescription="No organisation-wide or scoped stop is engaged."
            columns={[
              { key: 'scope', header: 'Scope', render: (row) => `${row.scope}${row.target ? ` · ${row.target}` : ''}` },
              { key: 'status', header: 'Status', render: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
              { key: 'reason', header: 'Reason', render: (row) => row.reason ?? '—' },
              { key: 'at', header: 'Raised', render: (row) => formatDateTime(row.createdAt) },
              { key: 'actions', header: 'Actions', render: (row) => rowActions('killSwitch', row) },
            ]}
          />
        )}
      </Card>

      <Card title="Protections" description="Every protection the engine raised, including cleared ones.">
        {protections.error && <ErrorNotice title="Protections unavailable" message={protections.error} />}
        {protections.data && (
          <DataTable
            rows={protectionRows}
            rowKey={(row) => row.id}
            emptyTitle="No protections recorded"
            emptyDescription="The engine has not had to intervene."
            columns={[
              { key: 'action', header: 'Action', render: (row) => row.action },
              { key: 'status', header: 'Status', render: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
              { key: 'account', header: 'Account', render: (row) => (row.accountId ? <code style={{ fontSize: 12 }}>{row.accountId.slice(0, 8)}</code> : '—') },
              { key: 'reason', header: 'Reason', render: (row) => row.reason ?? '—' },
              { key: 'at', header: 'Raised', render: (row) => formatDateTime(row.createdAt) },
              { key: 'cleared', header: 'Cleared', render: (row) => (row.clearedAt ? formatDateTime(row.clearedAt) : '—') },
            ]}
          />
        )}
      </Card>

      <Card title="Equity snapshots" description="Point-in-time captures the engine keeps for drawdown and loss calculations.">
        {snapshots.error && <ErrorNotice title="Snapshots unavailable" message={snapshots.error} />}
        {snapshots.data && (
          <DataTable
            rows={riskRows(snapshots.data).slice(0, 25)}
            rowKey={(row) => row.id}
            emptyTitle="No snapshots"
            columns={[
              { key: 'account', header: 'Account', render: (row) => <code style={{ fontSize: 12 }}>{(row.accountId ?? '—').slice(0, 8)}</code> },
              { key: 'equity', header: 'Equity', align: 'right', render: (row) => formatAmount(row.equity) },
              { key: 'exposure', header: 'Exposure', align: 'right', render: (row) => formatAmount(row.exposure) },
              { key: 'completeness', header: 'Completeness', render: (row) => row.dataCompleteness ?? '—' },
              { key: 'at', header: 'Captured', render: (row) => formatDateTime(row.capturedAt) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
