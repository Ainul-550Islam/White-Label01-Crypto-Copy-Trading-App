'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import { omsAdminApi, toRows, type OmsOperationalRecord } from '@/api/oms-admin-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, EmptyState, ErrorNotice } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { useResource } from '@/features/shared/use-resource';

/**
 * Operational exception handling for one account: stale orders, rejected
 * orders, retries, recoveries, acknowledgements and operator notes.
 *
 * Retry and recovery both re-submit or re-drive something that already failed,
 * so both need a reason and both get an Idempotency-Key per attempt. A retry is
 * never offered automatically: the operator decides, because the failure may
 * have been a venue-wide fault that a retry would amplify.
 */
const RECOVERY_TYPES = ['RESUBMIT', 'CANCEL_AND_REPLACE', 'MARK_FAILED', 'FORCE_RECONCILE'] as const;

type ActionKind = 'retry' | 'recovery' | 'acknowledge' | 'note';

export function OmsOperations(): JSX.Element {
  const [accountId, setAccountId] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const stale = useResource(() => omsAdminApi.getStaleOrders(loadedId ?? ''), [loadedId, version], { enabled: loadedId !== null, errorMessage: 'Stale orders could not be loaded.' });
  const rejected = useResource(() => omsAdminApi.getRejectedOperational(loadedId ?? ''), [loadedId, version], { enabled: loadedId !== null, errorMessage: 'Rejected orders could not be loaded.' });

  const [action, setAction] = useState<{ kind: ActionKind; record: OmsOperationalRecord } | null>(null);
  const [form, setForm] = useState({ reason: '', note: '', recoveryType: 'RESUBMIT' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  async function run(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!action) return;
    const intent = action.record.orderIntentId ?? '';
    if (intent === '') {
      setError('This record has no order intent, so no order action can be applied to it.');
      return;
    }

    const reason = form.reason.trim();
    const note = form.note.trim();

    if ((action.kind === 'retry' || action.kind === 'recovery') && reason.length < 5) {
      setError('Give a reason of at least five characters.');
      return;
    }
    if ((action.kind === 'acknowledge' || action.kind === 'note') && note.length < 3) {
      setError('Write a note of at least three characters.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (action.kind === 'retry') {
        await omsAdminApi.requestRetry({ intentId: intent, reason }, crypto.randomUUID());
        setMessage('The retry was accepted. The order re-enters routing on the next cycle.');
      } else if (action.kind === 'recovery') {
        await omsAdminApi.requestRecovery({ intentId: intent, recoveryType: form.recoveryType, reason }, crypto.randomUUID());
        setMessage(`The ${form.recoveryType.toLowerCase().replaceAll('_', ' ')} recovery was accepted.`);
      } else if (action.kind === 'acknowledge') {
        await omsAdminApi.acknowledgeException({ operationalId: action.record.id, note }, crypto.randomUUID());
        setMessage('The exception was acknowledged.');
      } else {
        await omsAdminApi.addOperatorNote({ operationalId: action.record.id, note }, crypto.randomUUID());
        setMessage('The note was recorded on the exception.');
      }
      setAction(null);
      setForm({ reason: '', note: '', recoveryType: 'RESUBMIT' });
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 403
          ? 'You do not have permission to act on this order.'
          : caught instanceof ApiError && caught.status === 409
            ? 'This order moved since the list loaded. Reload before acting again.'
            : 'The action was not confirmed. Nothing was changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  function recordTable(rows: OmsOperationalRecord[], emptyTitle: string, emptyDescription: string): JSX.Element {
    return (
      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
        columns={[
          { key: 'symbol', header: 'Symbol', render: (row) => row.symbol ?? '—' },
          { key: 'state', header: 'State', render: (row) => (row.state ? <Badge tone={toneForStatus(row.state)}>{row.state}</Badge> : '—') },
          { key: 'type', header: 'Type', render: (row) => row.type },
          { key: 'summary', header: 'Summary', render: (row) => row.summary ?? '—' },
          { key: 'created', header: 'Raised', render: (row) => formatDateTime(row.createdAt) },
          { key: 'acked', header: 'Acknowledged', render: (row) => (row.acknowledgedAt ? formatDateTime(row.acknowledgedAt) : 'Not yet') },
          { key: 'note', header: 'Last note', render: (row) => row.note ?? '—' },
          {
            key: 'actions',
            header: 'Actions',
            render: (row) => (
              <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
                <button type="button" disabled={busy} onClick={() => { setAction({ kind: 'retry', record: row }); setForm({ reason: '', note: '', recoveryType: 'RESUBMIT' }); setError(''); setMessage(''); }}>Retry</button>
                <button type="button" disabled={busy} onClick={() => { setAction({ kind: 'recovery', record: row }); setForm({ reason: '', note: '', recoveryType: 'RESUBMIT' }); setError(''); setMessage(''); }}>Recover</button>
                <button type="button" disabled={busy} onClick={() => { setAction({ kind: 'acknowledge', record: row }); setForm({ reason: '', note: '', recoveryType: 'RESUBMIT' }); setError(''); setMessage(''); }}>Acknowledge</button>
                <button type="button" disabled={busy} onClick={() => { setAction({ kind: 'note', record: row }); setForm({ reason: '', note: '', recoveryType: 'RESUBMIT' }); setError(''); setMessage(''); }}>Add note</button>
              </div>
            ),
          },
        ]}
      />
    );
  }

  const staleRows = toRows<OmsOperationalRecord>(stale.data).rows;
  const rejectedRows = toRows<OmsOperationalRecord>(rejected.data).rows;

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Choose an account" description="Exception lists are scoped to one account: stale and rejected orders are read per account by the OMS.">
        <form onSubmit={(event) => { event.preventDefault(); setLoadedId(accountId.trim() || null); }} aria-label="Load account exceptions" style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 320 }}>
            Account id
            <input required value={accountId} onChange={(event) => setAccountId(event.target.value)} disabled={stale.loading || rejected.loading} />
          </label>
          <button type="submit" disabled={stale.loading || rejected.loading}>Load exceptions</button>
        </form>
      </Card>

      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: 0, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
      {error && <ErrorNotice title="Action not completed" message={error} />}

      {action && (
        <Card
          title={
            action.kind === 'retry'
              ? 'Retry this order'
              : action.kind === 'recovery'
                ? 'Recover this order'
                : action.kind === 'acknowledge'
                  ? 'Acknowledge this exception'
                  : 'Add an operator note'
          }
          description={
            action.kind === 'retry'
              ? 'Re-submits the order through routing. Confirm the venue is healthy first: a retry into a broken venue doubles the exposure.'
              : action.kind === 'recovery'
                ? 'Tells the OMS how to resolve the failed order. The reason is stored with the recovery.'
                : 'Record what you found. This does not change the order state.'
          }
        >
          <form onSubmit={(event) => void run(event)} aria-label="Handle an operational exception" style={{ display: 'grid', gap: theme.space(3), maxWidth: 520 }}>
            {action.kind === 'recovery' && (
              <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                Recovery type
                <select value={form.recoveryType} onChange={(event) => setForm((current) => ({ ...current, recoveryType: event.target.value }))} disabled={busy}>
                  {RECOVERY_TYPES.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
                </select>
              </label>
            )}
            {(action.kind === 'retry' || action.kind === 'recovery') && (
              <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                Reason
                <textarea required rows={3} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} disabled={busy} />
              </label>
            )}
            {(action.kind === 'acknowledge' || action.kind === 'note') && (
              <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                Note
                <textarea required rows={3} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} disabled={busy} />
              </label>
            )}
            <div style={{ display: 'flex', gap: theme.space(2) }}>
              <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Confirm'}</button>
              <button type="button" disabled={busy} onClick={() => { setAction(null); setError(''); }}>Cancel</button>
            </div>
          </form>
        </Card>
      )}

      {loadedId && (
        <>
          <Card title="Stale orders" description="Orders past their expected acknowledgement or fill window. A stale order may still live at the venue.">
            {stale.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading stale orders…</p>}
            {stale.error && <ErrorNotice title="Stale orders unavailable" message={stale.error} />}
            {stale.data && staleRows.length === 0 && <EmptyState title="No stale orders" description="Nothing is past its window for this account." />}
            {staleRows.length > 0 && recordTable(staleRows, 'No stale orders', '')}
          </Card>

          <Card title="Rejected orders" description="Orders the venue or the OMS refused. A retry is only sensible when the rejection is retriable.">
            {rejected.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading rejected orders…</p>}
            {rejected.error && <ErrorNotice title="Rejected orders unavailable" message={rejected.error} />}
            {rejected.data && rejectedRows.length === 0 && <EmptyState title="No rejected orders" description="Nothing has been rejected for this account." />}
            {rejectedRows.length > 0 && recordTable(rejectedRows, 'No rejected orders', '')}
          </Card>
        </>
      )}
    </div>
  );
}
