'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import { omsAdminApi, toRows, type ReconciliationFinding, type ReconciliationQuery, type ReconciliationResult } from '@/api/oms-admin-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * The reconciliation queue.
 *
 * A finding says the platform's record and the venue's record disagree. The only
 * write on this surface is an acknowledgement with a written resolution note -
 * there is no "mark matched", because a human decision cannot make two ledgers
 * agree. The queue therefore keeps `resolved` separate from the acknowledgement
 * and shows both.
 */
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

export function OmsReconciliationQueue(): JSX.Element {
  const [draft, setDraft] = useState<ReconciliationQuery>({ state: 'OPEN' });
  const [query, setQuery] = useState<ReconciliationQuery>({ state: 'OPEN' });
  const [version, setVersion] = useState(0);
  const queue = useResource(() => omsAdminApi.getReconQueue(query), [query, version], { errorMessage: 'The reconciliation queue could not be loaded.' });

  const [selected, setSelected] = useState<ReconciliationFinding | null>(null);
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('RESOLVED');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  const [scanAccount, setScanAccount] = useState('');
  const [scan, setScan] = useState<ReconciliationResult | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  async function acknowledge(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected) return;
    const trimmed = note.trim();
    if (trimmed.length < 10) {
      setError('Write what you found and what you did - at least ten characters. It becomes the resolution record.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await omsAdminApi.acknowledgeReconciliation(
        { reconciliationId: selected.id, resolutionNote: trimmed, resolution },
        crypto.randomUUID(),
      );
      setMessage('The finding was acknowledged with your note.');
      setSelected(null);
      setNote('');
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 409
          ? 'This finding was already acknowledged by someone else. Reload to see their note.'
          : caught instanceof ApiError && caught.status === 403
            ? 'You do not have permission to acknowledge reconciliation findings.'
            : 'The acknowledgement was not recorded.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function runScan(): Promise<void> {
    if (scanAccount.trim() === '') {
      setError('Give an account id to reconcile.');
      return;
    }
    setScanning(true);
    setError('');
    setMessage('');
    try {
      const result = await omsAdminApi.reconcileOrders({ accountId: scanAccount.trim(), limit: 100 }, crypto.randomUUID());
      setScan(result);
      setVersion((current) => current + 1);
    } catch {
      setError('The reconciliation run did not complete. Treat the account as unreconciled.');
    } finally {
      setScanning(false);
    }
  }

  const rows = toRows<ReconciliationFinding>(queue.data).rows;
  const unresolved = rows.filter((row) => !row.resolved).length;

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Run a reconciliation" description="Compares the platform's orders with the venue for one account and queues any disagreement it finds.">
        <form onSubmit={(event) => { event.preventDefault(); void runScan(); }} aria-label="Reconcile an account" style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 300 }}>
            Account id
            <input required value={scanAccount} onChange={(event) => setScanAccount(event.target.value)} disabled={scanning} />
          </label>
          <button type="submit" disabled={scanning}>{scanning ? 'Reconciling…' : 'Reconcile now'}</button>
        </form>
        {scan && (
          <p role="status" aria-live="polite" style={{ margin: `${theme.space(3)} 0 0`, fontSize: 13 }}>
            {scan.matched === true
              ? `Checked ${scan.checked} order(s) and they match the venue.`
              : scan.matched === false
                ? `Checked ${scan.checked} order(s): ${scan.findings.length} disagreement(s) queued below.`
                : (scan.note ?? 'The comparison could not be completed, so the result is unknown rather than clean.')}
          </p>
        )}
      </Card>

      <Card
        title="Queue"
        description="Every open disagreement, newest first. Acknowledgement records a decision; it does not change the venue's records."
        actions={<button type="button" disabled={queue.loading} onClick={() => setVersion((current) => current + 1)}>Refresh</button>}
      >
        <form
          onSubmit={(event) => { event.preventDefault(); setQuery({ ...draft }); }}
          aria-label="Filter reconciliation findings"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: theme.space(3), alignItems: 'end', marginBottom: theme.space(4) }}
        >
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            State
            <select value={draft.state ?? ''} onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value || undefined }))} disabled={queue.loading}>
              <option value="">All</option>
              <option value="OPEN">Open</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Category
            <input value={draft.category ?? ''} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value || undefined }))} disabled={queue.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Account id
            <input value={draft.accountId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, accountId: event.target.value || undefined }))} disabled={queue.loading} />
          </label>
          <div style={{ display: 'flex', gap: theme.space(2) }}>
            <button type="submit" disabled={queue.loading}>Apply</button>
            <button type="button" disabled={queue.loading} onClick={() => { setDraft({ state: 'OPEN' }); setQuery({ state: 'OPEN' }); }}>Reset</button>
          </div>
        </form>

        <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', marginBottom: theme.space(4) }}>
          <StatTile label="Findings" value={rows.length} />
          <StatTile label="Unresolved" value={unresolved} hint={unresolved > 0 ? 'Needs a decision' : 'Queue clear'} />
          <StatTile label="Critical" value={rows.filter((row) => row.severity?.toUpperCase() === 'CRITICAL').length} />
        </div>

        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: `0 0 ${theme.space(3)}`, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
        {error && <ErrorNotice title="Action not recorded" message={error} />}
        {queue.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading findings…</p>}
        {queue.error && <ErrorNotice title="Queue unavailable" message={queue.error} />}
        {queue.data && rows.length === 0 && <EmptyState title="Nothing to reconcile" description="The platform and the venue agree for this filter." />}

        {rows.length > 0 && (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            emptyTitle="No findings"
            columns={[
              { key: 'severity', header: 'Severity', render: (row) => <Badge tone={toneForStatus(row.severity)}>{row.severity}</Badge> },
              { key: 'category', header: 'Category', render: (row) => row.category },
              { key: 'summary', header: 'Finding', render: (row) => row.summary },
              {
                key: 'expected',
                header: 'Expected / actual',
                render: (row) => (
                  <span style={{ fontSize: 12 }}>
                    {row.expected ? `qty ${formatAmount(row.expected.quantity ?? null)}, state ${row.expected.state ?? '—'}` : '—'}
                    <br />
                    {row.actual ? `qty ${formatAmount(row.actual.quantity ?? null)}, state ${row.actual.state ?? '—'}` : '—'}
                  </span>
                ),
              },
              { key: 'state', header: 'Resolved', render: (row) => <Badge tone={row.resolved ? 'success' : 'warning'}>{row.resolved ? 'Yes' : 'No'}</Badge> },
              { key: 'at', header: 'Found', render: (row) => formatDateTime(row.timestamp) },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) =>
                  row.resolved ? (
                    <span style={{ fontSize: 12, color: theme.color.textMuted }}>{row.resolutionNote ?? 'Acknowledged'}</span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => { setSelected(row); setNote(''); setError(''); setMessage(''); }}>Acknowledge</button>
                  ),
              },
            ]}
          />
        )}
      </Card>

      {selected && (
        <Card title={`Acknowledge ${selected.category}`} description={selected.summary}>
          <form onSubmit={(event) => void acknowledge(event)} aria-label="Acknowledge a reconciliation finding" style={{ display: 'grid', gap: theme.space(3), maxWidth: 560 }}>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Resolution
              <select value={resolution} onChange={(event) => setResolution(event.target.value)} disabled={busy}>
                {['RESOLVED', 'ACCEPTED_DIFFERENCE', 'ESCALATED', 'NO_ACTION_NEEDED'].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              What you found and did
              <textarea required rows={4} value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} />
            </label>
            <div style={{ display: 'flex', gap: theme.space(2) }}>
              <button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record acknowledgement'}</button>
              <button type="button" disabled={busy} onClick={() => { setSelected(null); setError(''); }}>Back</button>
            </div>
          </form>
        </Card>
      )}

      <p style={{ margin: 0, fontSize: 12, color: theme.color.textMuted }}>
        Severities the service reports: {SEVERITIES.join(', ')}.
      </p>
    </div>
  );
}
