'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import {
  custodyAdminApi,
  type CustodyFinding,
  type ReconciliationRunResult,
} from '@/api/custody-admin-api';
import { Badge, Card, DataTable, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';

import { useResource } from '@/features/shared/use-resource';

/**
 * Reconciliation runs and the breaks they found.
 *
 * Two things this page refuses to do:
 *
 *  * It never renders an empty findings table as "everything reconciles" when
 *    the run itself could not read the chain. `dataCompleteness` from the run is
 *    shown next to the counts, and PARTIAL_UNKNOWN/UNKNOWN_NO_WALLET are called
 *    out in words.
 *  * It never resolves a finding silently. Resolution requires a reason and the
 *    operator identity, both of which the API stores against the row, and the
 *    request carries an Idempotency-Key so a double click cannot write twice.
 */
export function ReconciliationTable({ canRun, canResolve, operatorId }: { canRun: boolean; canResolve: boolean; operatorId: string }): JSX.Element {
  const [showResolved, setShowResolved] = useState(false);
  const [page, setPage] = useState(1);
  const findings = useResource(
    () => custodyAdminApi.listFindings({ resolved: showResolved, page, limit: 25 }),
    [showResolved, page],
    { errorMessage: 'Reconciliation findings could not be loaded.' },
  );

  const [run, setRun] = useState<ReconciliationRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const runStatusRef = useRef<HTMLParagraphElement>(null);

  const [resolving, setResolving] = useState<CustodyFinding | null>(null);
  const [resolution, setResolution] = useState({ reason: '', resolution: 'ADJUSTED' });
  const [resolveError, setResolveError] = useState('');
  const [resolveMessage, setResolveMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const resolveKey = useRef<{ identity: string; key: string } | null>(null);
  const resolveStatusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (run || runError) runStatusRef.current?.focus();
  }, [run, runError]);

  useEffect(() => {
    if (resolveMessage || resolveError) resolveStatusRef.current?.focus();
  }, [resolveMessage, resolveError]);

  async function startRun(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const assetId = String(data.get('assetId') ?? '').trim();
    const networkId = String(data.get('networkId') ?? '').trim();

    setRunning(true);
    setRunError('');
    setRun(null);
    try {
      const result = await custodyAdminApi.runReconciliation(
        { assetId: assetId || null, networkId: networkId || null },
        crypto.randomUUID(),
      );
      setRun(result);
      findings.reload();
    } catch {
      setRunError('The reconciliation run did not complete. No finding was resolved by it.');
    } finally {
      setRunning(false);
    }
  }

  async function resolve(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!resolving) return;
    if (resolution.reason.trim().length < 5) {
      setResolveError('Give a reason of at least five characters; it is stored against the finding.');
      return;
    }

    const identity = `${resolving.id}:${resolution.resolution}:${resolution.reason.trim()}`;
    if (resolveKey.current?.identity !== identity) {
      resolveKey.current = { identity, key: crypto.randomUUID() };
    }

    setBusy(true);
    setResolveError('');
    setResolveMessage('');
    try {
      await custodyAdminApi.resolveFinding(
        { findingId: resolving.id, reason: resolution.reason.trim(), resolution: resolution.resolution, operatorId },
        resolveKey.current.key,
      );
      resolveKey.current = null;
      setResolveMessage('The finding was resolved and the decision recorded.');
      setResolving(null);
      setResolution({ reason: '', resolution: 'ADJUSTED' });
      findings.reload();
    } catch {
      setResolveError('The finding could not be resolved. It is still open.');
    } finally {
      setBusy(false);
    }
  }

  const rows = findings.data?.data ?? [];
  const total = findings.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / 25));

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      {canRun && (
        <Card
          title="Run a reconciliation"
          description="Compares the ledger against the chain provider. Leave asset and network empty to sweep everything visible to this organisation."
        >
          <form onSubmit={(event) => void startRun(event)} aria-label="Run reconciliation" style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Asset (optional)
              <input name="assetId" disabled={running} placeholder="USDT" />
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Network (optional)
              <input name="networkId" disabled={running} placeholder="ethereum" />
            </label>
            <button type="submit" disabled={running}>{running ? 'Running…' : 'Run reconciliation'}</button>
          </form>

          <div ref={runStatusRef} tabIndex={-1} aria-live="polite" style={{ marginTop: theme.space(4) }}>
            {runError && <ErrorNotice title="Run not completed" message={runError} />}
            {run && (
              <div style={{ display: 'grid', gap: theme.space(3) }}>
                <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap' }}>
                  <StatTile label="Findings created" value={run.findingsCreated} />
                  <StatTile label="Wallets checked" value={run.walletsChecked} />
                  <StatTile label="Transactions checked" value={run.transactionsChecked} />
                  <StatTile label="Deposits checked" value={run.depositsChecked} />
                  <StatTile label="Could not verify" value={run.unverifiable} hint="Rows the provider did not answer for" />
                </div>
                <p style={{ margin: 0, fontSize: 13 }}>
                  <Badge tone={run.dataCompleteness === 'PROVIDER_DERIVED' ? 'success' : 'warning'}>{run.dataCompleteness}</Badge>{' '}
                  {run.dataCompleteness === 'PROVIDER_DERIVED'
                    ? 'Every row was read from the provider, so an empty result means the books agree.'
                    : 'Some rows could not be read from the provider. An empty result here does not prove the books agree.'}
                </p>
                <p style={{ margin: 0, fontSize: 12, color: theme.color.textMuted }}>
                  Started {formatDateTime(run.startedAt)} · completed {formatDateTime(run.completedAt)}
                </p>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card
        title={showResolved ? 'Resolved findings' : 'Open findings'}
        description="Each row is a break between the ledger and the chain. Critical breaks are shown first by the API."
        actions={
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Show
            <select
              value={showResolved ? 'RESOLVED' : 'OPEN'}
              onChange={(event) => { setPage(1); setShowResolved(event.target.value === 'RESOLVED'); }}
              disabled={findings.loading}
            >
              <option value="OPEN">Open</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </label>
        }
      >
        {findings.loading && rows.length === 0 && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading findings…</p>}
        {findings.error && <ErrorNotice title="Findings unavailable" message={findings.error} />}

        {findings.data && (
          <>
            <DataTable
              rows={rows}
              rowKey={(row) => row.id}
              emptyTitle={showResolved ? 'No resolved findings' : 'No open findings'}
              emptyDescription={
                showResolved
                  ? 'Resolved breaks appear here with the reason recorded against them.'
                  : 'No break was recorded by the last run. Check the run completeness above before treating the books as balanced.'
              }
              columns={[
                { key: 'type', header: 'Type', render: (row) => <span style={{ fontSize: 13 }}>{row.discrepancyType ?? row.reconciliationType}</span> },
                { key: 'scope', header: 'Subject', render: (row) => <code style={{ fontSize: 12 }}>{(row.walletId ?? row.transactionId ?? row.depositId ?? row.withdrawalId ?? '—').slice(0, 8)}</code> },
                { key: 'critical', header: 'Severity', render: (row) => <Badge tone={row.isCritical ? 'danger' : 'warning'}>{row.isCritical ? 'Critical' : 'Review'}</Badge> },
                { key: 'status', header: 'Status', render: (row) => <Badge tone={row.isResolved ? 'success' : toneForStatus('PENDING')}>{row.isResolved ? 'Resolved' : 'Open'}</Badge> },
                { key: 'created', header: 'Found', render: (row) => formatDateTime(row.createdAt) },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (row) =>
                    row.isResolved || !canResolve ? (
                      <span style={{ color: theme.color.textMuted }}>—</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setResolving(row); setResolveError(''); setResolveMessage(''); }}
                        disabled={busy}
                      >
                        Resolve
                      </button>
                    ),
                },
              ]}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(3), marginTop: theme.space(4) }}>
              <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || findings.loading}>Previous</button>
              <span style={{ fontSize: 13, color: theme.color.textMuted }} aria-live="polite">Page {page} of {lastPage} · {total} finding{total === 1 ? '' : 's'}</span>
              <button type="button" onClick={() => setPage((value) => Math.min(lastPage, value + 1))} disabled={page >= lastPage || findings.loading}>Next</button>
            </div>
          </>
        )}
      </Card>

      {resolving && (
        <Card title={`Resolve ${resolving.discrepancyType ?? resolving.reconciliationType}`} description="The reason and the operator identity are stored against the finding and cannot be edited afterwards.">
          <form onSubmit={(event) => void resolve(event)} aria-label="Resolve a reconciliation finding" style={{ display: 'grid', gap: theme.space(3), maxWidth: 520 }}>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Resolution
              <select value={resolution.resolution} onChange={(event) => setResolution((current) => ({ ...current, resolution: event.target.value }))} disabled={busy}>
                <option value="ADJUSTED">Ledger adjusted to match the chain</option>
                <option value="PROVIDER_CORRECTED">Provider record corrected</option>
                <option value="NO_ACTION_REQUIRED">No action required</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Reason
              <textarea
                required
                rows={3}
                value={resolution.reason}
                onChange={(event) => setResolution((current) => ({ ...current, reason: event.target.value }))}
                disabled={busy}
              />
            </label>
            <p ref={resolveStatusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: 0, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{resolveMessage}</p>
            {resolveError && <ErrorNotice title="Finding still open" message={resolveError} />}
            <div style={{ display: 'flex', gap: theme.space(2) }}>
              <button type="submit" disabled={busy}>{busy ? 'Resolving…' : 'Resolve finding'}</button>
              <button type="button" disabled={busy} onClick={() => { setResolving(null); setResolveError(''); }}>Cancel</button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
