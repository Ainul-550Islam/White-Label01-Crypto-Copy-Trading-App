'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import {
  executionOrdersAdminApi,
  executionRows,
  type DiscrepancyListQuery,
  type ExecutionKillSwitch,
  type ReconciliationDiscrepancy,
  type ReconciliationRun,
  type RunListQuery,
} from '@/api/execution-orders-admin-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { useResource } from '@/features/shared/use-resource';

/**
 * Execution reconciliation and kill switches.
 *
 * The controller's own doc comments shape this screen:
 *
 *  * a run list with a gap is itself the signal that reconciliation stopped, so
 *    the newest run's age is shown as a stat rather than left implicit;
 *  * closing a discrepancy marks it reviewed and never edits the order, balance
 *    or position it was about - the note says so, and the resolve form demands a
 *    note of at least five characters;
 *  * releasing a kill switch needs the same reason the DTO requires, and the
 *    GLOBAL switch is shown but not offered for release from a tenant console.
 */
const SCOPES = ['EXCHANGE', 'STRATEGY', 'SYMBOL'] as const;

export function ExecutionReconciliationPanel(): JSX.Element {
  const [runQuery, setRunQuery] = useState<RunListQuery>({ limit: 20 });
  const [discrepancyQuery, setDiscrepancyQuery] = useState<DiscrepancyListQuery>({ limit: 25 });
  const [version, setVersion] = useState(0);

  const runs = useResource(() => executionOrdersAdminApi.listReconciliationRuns(runQuery), [runQuery, version], { errorMessage: 'Reconciliation runs could not be loaded.' });
  const discrepancies = useResource(() => executionOrdersAdminApi.listDiscrepancies(discrepancyQuery), [discrepancyQuery, version], { errorMessage: 'Discrepancies could not be loaded.' });
  const switches = useResource(() => executionOrdersAdminApi.listKillSwitches(), [version], { errorMessage: 'Kill switches could not be loaded.' });

  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const runDetail = useResource(() => executionOrdersAdminApi.getReconciliationRun(selectedRun ?? ''), [selectedRun], {
    enabled: selectedRun !== null,
    errorMessage: 'The run could not be loaded.',
  });

  const [resolving, setResolving] = useState<ReconciliationDiscrepancy | null>(null);
  const [note, setNote] = useState('');
  const [queueAccount, setQueueAccount] = useState('');
  const [switchForm, setSwitchForm] = useState({ scope: 'EXCHANGE', target: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  async function resolve(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!resolving) return;
    const trimmed = note.trim();
    if (trimmed.length < 5) {
      setError('Write a review note of at least five characters. It is stored as the resolution record.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await executionOrdersAdminApi.resolveDiscrepancy(resolving.id, trimmed, crypto.randomUUID());
      setMessage('The discrepancy was marked reviewed. The order, balance or position it described was not modified.');
      setResolving(null);
      setNote('');
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 409
          ? 'This discrepancy was already reviewed by someone else.'
          : 'The review was not recorded.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function queuePass(): Promise<void> {
    if (queueAccount.trim() === '') {
      setError('Enter the account id to reconcile.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const accepted = await executionOrdersAdminApi.reconcileAccount(queueAccount.trim(), crypto.randomUUID());
      setMessage(`A reconciliation pass was queued (job ${accepted.jobId.slice(0, 8)}). Results appear here when it finishes.`);
      setVersion((current) => current + 1);
    } catch {
      setError('The pass was not queued.');
    } finally {
      setBusy(false);
    }
  }

  async function setSwitch(engaged: boolean, target?: ExecutionKillSwitch): Promise<void> {
    const scope = target ? (target.scope as (typeof SCOPES)[number] | 'GLOBAL') : (switchForm.scope as (typeof SCOPES)[number]);
    const switchTarget = target ? (target.target ?? '') : switchForm.target.trim();
    const reason = switchForm.reason.trim();

    if (reason.length < 5) {
      setError('The API requires a reason of at least five characters for a kill switch change.');
      return;
    }
    if (scope !== 'GLOBAL' && switchTarget === '') {
      setError('Give the venue, strategy or symbol the switch applies to.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await executionOrdersAdminApi.setKillSwitch(
        { scope, engaged, reason, ...(switchTarget ? { target: switchTarget } : {}) },
        crypto.randomUUID(),
      );
      setMessage(engaged ? 'The switch is engaged. New risk in scope is stopped.' : 'The switch was released.');
      setSwitchForm({ scope: 'EXCHANGE', target: '', reason: '' });
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 403
          ? 'You do not have permission to operate this switch.'
          : 'The switch was not changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  const runRows = executionRows<ReconciliationRun>(runs.data).rows;
  const discrepancyRows = executionRows<ReconciliationDiscrepancy>(discrepancies.data).rows;
  const switchRows = switches.data ?? [];
  const newestRun = runRows[0];

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Reconciliation posture" description="How recently reconciliation ran, and what it found.">
        <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', marginBottom: theme.space(4) }}>
          <StatTile label="Runs listed" value={runRows.length} />
          <StatTile label="Latest run" value={newestRun ? newestRun.status : 'None'} hint={newestRun?.startedAt ? formatRelative(newestRun.startedAt) : 'Reconciliation has not run'} />
          <StatTile label="Open discrepancies" value={discrepancyRows.filter((row) => !row.reviewed).length} />
          <StatTile label="Engaged switches" value={switchRows.filter((row) => row.isEngaged).length} />
        </div>

        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: `0 0 ${theme.space(3)}`, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
        {error && <ErrorNotice title="Action not completed" message={error} />}

        <form
          onSubmit={(event) => { event.preventDefault(); void queuePass(); }}
          aria-label="Queue a reconciliation pass"
          style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 300 }}>
            Account id to reconcile
            <input value={queueAccount} onChange={(event) => setQueueAccount(event.target.value)} disabled={busy} />
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Queueing…' : 'Queue pass'}</button>
        </form>
      </Card>

      <Card title="Runs" description="Includes runs that found nothing and runs that failed. A gap here is itself a signal.">
        <form
          onSubmit={(event) => event.preventDefault()}
          aria-label="Filter reconciliation runs"
          style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: theme.space(4) }}
        >
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Status
            <select value={runQuery.status ?? ''} onChange={(event) => setRunQuery((current) => ({ ...current, status: event.target.value || undefined }))} disabled={runs.loading}>
              <option value="">All</option>
              {['RUNNING', 'COMPLETED', 'SKIPPED', 'FAILED'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Account id
            <input value={runQuery.accountId ?? ''} onChange={(event) => setRunQuery((current) => ({ ...current, accountId: event.target.value || undefined }))} disabled={runs.loading} />
          </label>
        </form>

        {runs.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading runs…</p>}
        {runs.error && <ErrorNotice title="Runs unavailable" message={runs.error} />}
        {runs.data && runRows.length === 0 && <EmptyState title="No reconciliation runs" description="Nothing has been reconciled yet; treat every balance and position as unconfirmed." />}

        {runRows.length > 0 && (
          <DataTable
            rows={runRows}
            rowKey={(row) => row.id}
            emptyTitle="No runs"
            columns={[
              { key: 'status', header: 'Status', render: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
              { key: 'account', header: 'Account', render: (row) => (row.accountId ? <code style={{ fontSize: 12 }}>{String(row.accountId).slice(0, 8)}</code> : '—') },
              { key: 'trigger', header: 'Trigger', render: (row) => row.trigger ?? '—' },
              { key: 'checked', header: 'Orders checked', align: 'right', render: (row) => (row.ordersChecked === null || row.ordersChecked === undefined ? '—' : String(row.ordersChecked)) },
              { key: 'found', header: 'Discrepancies', align: 'right', render: (row) => (row.discrepanciesFound === null || row.discrepanciesFound === undefined ? '—' : String(row.discrepanciesFound)) },
              { key: 'started', header: 'Started', render: (row) => (row.startedAt ? formatDateTime(row.startedAt) : '—') },
              { key: 'error', header: 'Error', render: (row) => row.errorCode ?? '—' },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) => (
                  <button type="button" disabled={busy} onClick={() => { setSelectedRun(row.id); setError(''); setMessage(''); }}>Open</button>
                ),
              },
            ]}
          />
        )}

        {selectedRun && (
          <div style={{ marginTop: theme.space(4) }}>
            {runDetail.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading run…</p>}
            {runDetail.error && <ErrorNotice title="Run unavailable" message={runDetail.error} />}
            {runDetail.data && (
              <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: theme.space(3), margin: 0 }}>
                {[
                  ['Run', runDetail.data.id.slice(0, 8)],
                  ['Status', runDetail.data.status],
                  ['Started', runDetail.data.startedAt ? formatDateTime(runDetail.data.startedAt) : '—'],
                  ['Completed', runDetail.data.completedAt ? formatDateTime(runDetail.data.completedAt) : 'Still running'],
                  ['Orders checked', runDetail.data.ordersChecked === null || runDetail.data.ordersChecked === undefined ? 'Not recorded' : String(runDetail.data.ordersChecked)],
                  ['Discrepancies', runDetail.data.discrepanciesFound === null || runDetail.data.discrepanciesFound === undefined ? 'Not recorded' : String(runDetail.data.discrepanciesFound)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt style={{ fontSize: 11, textTransform: 'uppercase', color: theme.color.textMuted }}>{label}</dt>
                    <dd style={{ margin: 0, fontSize: 13 }}>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </Card>

      <Card title="Discrepancies" description="What the platform believed versus what the venue reported. Closing one records a review; it changes no order.">
        <form
          onSubmit={(event) => event.preventDefault()}
          aria-label="Filter discrepancies"
          style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: theme.space(4) }}
        >
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Type
            <input value={discrepancyQuery.discrepancyType ?? ''} onChange={(event) => setDiscrepancyQuery((current) => ({ ...current, discrepancyType: event.target.value || undefined }))} disabled={discrepancies.loading} />
          </label>
          <label style={{ display: 'flex', gap: theme.space(2), alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={Boolean(discrepancyQuery.includeRepaired)}
              onChange={(event) => setDiscrepancyQuery((current) => ({ ...current, includeRepaired: event.target.checked || undefined }))}
              disabled={discrepancies.loading}
            />
            Include closed
          </label>
        </form>

        {discrepancies.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading discrepancies…</p>}
        {discrepancies.error && <ErrorNotice title="Discrepancies unavailable" message={discrepancies.error} />}
        {discrepancies.data && discrepancyRows.length === 0 && (
          <EmptyState title="No discrepancies" description="Either nothing diverged, or reconciliation has not compared anything yet - check the runs above." />
        )}

        {discrepancyRows.length > 0 && (
          <DataTable
            rows={discrepancyRows}
            rowKey={(row) => row.id}
            emptyTitle="No discrepancies"
            columns={[
              { key: 'type', header: 'Type', render: (row) => <Badge tone="warning">{row.discrepancyType}</Badge> },
              { key: 'account', header: 'Account', render: (row) => (row.accountId ? <code style={{ fontSize: 12 }}>{String(row.accountId).slice(0, 8)}</code> : '—') },
              {
                key: 'values',
                header: 'Expected / actual',
                render: (row) => (
                  <span style={{ fontSize: 12 }}>
                    {row.expected ? JSON.stringify(row.expected).slice(0, 60) : '—'}
                    <br />
                    {row.actual ? JSON.stringify(row.actual).slice(0, 60) : '—'}
                  </span>
                ),
              },
              { key: 'reviewed', header: 'Reviewed', render: (row) => <Badge tone={row.reviewed ? 'success' : 'warning'}>{row.reviewed ? 'Yes' : 'No'}</Badge> },
              { key: 'at', header: 'Found', render: (row) => (row.createdAt ? formatDateTime(row.createdAt) : '—') },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) =>
                  row.reviewed ? (
                    <span style={{ fontSize: 12, color: theme.color.textMuted }}>{row.resolutionNote ?? 'Reviewed'}</span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => { setResolving(row); setNote(''); setError(''); setMessage(''); }}>Review</button>
                  ),
              },
            ]}
          />
        )}
      </Card>

      {resolving && (
        <Card title={`Review ${resolving.discrepancyType}`} description="This records your review. It does not alter the order, balance or position that diverged; that is a separate, separately audited action.">
          <form onSubmit={(event) => void resolve(event)} aria-label="Record a discrepancy review" style={{ display: 'grid', gap: theme.space(3), maxWidth: 560 }}>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Review note
              <textarea required rows={4} value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} />
            </label>
            <div style={{ display: 'flex', gap: theme.space(2) }}>
              <button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record review'}</button>
              <button type="button" disabled={busy} onClick={() => { setResolving(null); setError(''); }}>Back</button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Kill switches" description="Engaging stops new risk for the scope. Releasing needs a written reason; the platform-wide switch is visible but is released at platform level.">
        <form
          onSubmit={(event) => { event.preventDefault(); void setSwitch(true); }}
          aria-label="Engage a kill switch"
          style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: theme.space(4) }}
        >
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Scope
            <select value={switchForm.scope} onChange={(event) => setSwitchForm((current) => ({ ...current, scope: event.target.value }))} disabled={busy}>
              {SCOPES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 200 }}>
            Target
            <input value={switchForm.target} onChange={(event) => setSwitchForm((current) => ({ ...current, target: event.target.value }))} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 260 }}>
            Reason
            <input required value={switchForm.reason} onChange={(event) => setSwitchForm((current) => ({ ...current, reason: event.target.value }))} disabled={busy} />
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Engaging…' : 'Engage'}</button>
        </form>

        {switches.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading switches…</p>}
        {switches.error && <ErrorNotice title="Kill switches unavailable" message={switches.error} />}
        {switches.data && (
          <DataTable
            rows={switchRows}
            rowKey={(row) => row.id}
            emptyTitle="No kill switches"
            emptyDescription="Nothing is halted for this organisation."
            columns={[
              { key: 'scope', header: 'Scope', render: (row) => <Badge>{row.scope}</Badge> },
              { key: 'target', header: 'Target', render: (row) => row.target ?? '—' },
              { key: 'state', header: 'State', render: (row) => <Badge tone={row.isEngaged ? 'danger' : 'neutral'}>{row.isEngaged ? 'Engaged' : 'Released'}</Badge> },
              { key: 'reason', header: 'Reason', render: (row) => row.reason ?? '—' },
              { key: 'at', header: 'Engaged', render: (row) => (row.engagedAt ? formatRelative(row.engagedAt) : '—') },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) =>
                  row.scope === 'GLOBAL' ? (
                    <span style={{ fontSize: 12, color: theme.color.textMuted }}>Platform level</span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => void setSwitch(!row.isEngaged, row)}>
                      {row.isEngaged ? 'Release' : 'Engage'}
                    </button>
                  ),
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
