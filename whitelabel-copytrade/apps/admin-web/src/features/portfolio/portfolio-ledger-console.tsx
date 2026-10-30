'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import {
  accountingRows,
  ACCOUNTING_SCOPES,
  ADJUSTMENT_TYPES,
  portfolioAccountingAdminApi,
  type AccountingPeriod,
  type AccountingSnapshot,
  type PortfolioQuery,
} from '@/api/portfolio-accounting-admin-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * The accounting ledger console: profiles, ledger reads, snapshots, periods,
 * adjustments and reconciliations.
 *
 * Three properties the service enforces are preserved here rather than
 * re-implemented:
 *
 *  * Every write that touches the ledger - a snapshot, a period close, an
 *    adjustment, a reconciliation - carries an Idempotency-Key, so a retry after
 *    a timeout cannot double-post.
 *  * An adjustment needs a reason of at least five characters. It is not
 *    optional: the ledger keeps it beside the corrected figure.
 *  * A closed period cannot be reopened - there is no route for it - so the
 *    console says that plainly instead of offering a button that would fail.
 *
 * Amounts are decimal strings end to end; nothing here converts one to a
 * floating-point number.
 */
export function PortfolioLedgerConsole(): JSX.Element {
  const [profileId, setProfileId] = useState('');
  const [loadedProfile, setLoadedProfile] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const query: PortfolioQuery = loadedProfile ? { profileId: loadedProfile, limit: 50 } : { limit: 50 };
  const profiles = useResource(() => portfolioAccountingAdminApi.listProfiles({ limit: 50 }), [version], { errorMessage: 'Profiles could not be loaded.' });
  const events = useResource(() => portfolioAccountingAdminApi.listEvents(query), [loadedProfile, version], { enabled: loadedProfile !== null, errorMessage: 'Ledger events could not be loaded.' });
  const cash = useResource(() => portfolioAccountingAdminApi.listCash(query), [loadedProfile, version], { enabled: loadedProfile !== null, errorMessage: 'The cash ledger could not be loaded.' });
  const positions = useResource(() => portfolioAccountingAdminApi.listPositions(query), [loadedProfile, version], { enabled: loadedProfile !== null, errorMessage: 'Positions could not be loaded.' });
  const periods = useResource(() => portfolioAccountingAdminApi.listPeriods(query), [loadedProfile, version], { enabled: loadedProfile !== null, errorMessage: 'Periods could not be loaded.' });
  const adjustments = useResource(() => portfolioAccountingAdminApi.listAdjustments(query), [loadedProfile, version], { enabled: loadedProfile !== null, errorMessage: 'Adjustments could not be loaded.' });
  const reconciliations = useResource(() => portfolioAccountingAdminApi.listReconciliations(query), [loadedProfile, version], { enabled: loadedProfile !== null, errorMessage: 'Reconciliations could not be loaded.' });

  const [snapshotForm, setSnapshotForm] = useState({ scope: 'FOLLOWER', scopeId: '', timestamp: '' });
  const [periodForm, setPeriodForm] = useState({ periodStart: '', periodEnd: '', periodType: 'MONTHLY' });
  const [adjustmentForm, setAdjustmentForm] = useState({ adjustmentType: 'CORRECTION', reason: '', adjustedAmount: '', adjustedQuantity: '', asset: '', originalEventId: '' });
  const [closedSnapshot, setClosedSnapshot] = useState<AccountingSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  function handle(caught: unknown, fallback: string): void {
    setError(
      caught instanceof ApiError && caught.status === 403
        ? 'Accounting administration requires the reconciliation trigger permission.'
        : caught instanceof ApiError && caught.status === 404
          ? 'That profile or period is not visible to you.'
          : caught instanceof ApiError && caught.status === 422
            ? 'The service rejected these values. Check the dates and the amounts before retrying.'
            : fallback,
    );
  }

  async function postSnapshot(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!loadedProfile) return;
    if (snapshotForm.scopeId.trim() === '') {
      setError('A snapshot needs the scope id it belongs to.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const snapshot = await portfolioAccountingAdminApi.createSnapshot(
        {
          profileId: loadedProfile,
          scope: snapshotForm.scope,
          scopeId: snapshotForm.scopeId.trim(),
          ...(snapshotForm.timestamp ? { timestamp: snapshotForm.timestamp } : {}),
        },
        crypto.randomUUID(),
      );
      setClosedSnapshot(snapshot);
      setMessage(`Snapshot recorded at ${formatDateTime(snapshot.timestamp ?? snapshot.createdAt)}. Figures after this point use it as the base.`);
      setVersion((current) => current + 1);
    } catch (caught) {
      handle(caught, 'The snapshot was not recorded.');
    } finally {
      setBusy(false);
    }
  }

  async function postPeriod(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!loadedProfile) return;
    if (!periodForm.periodStart || !periodForm.periodEnd) {
      setError('A period needs a start and an end date.');
      return;
    }
    if (periodForm.periodEnd < periodForm.periodStart) {
      setError('The period end cannot be before its start.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const period = await portfolioAccountingAdminApi.createPeriod(
        { profileId: loadedProfile, periodStart: periodForm.periodStart, periodEnd: periodForm.periodEnd, periodType: periodForm.periodType },
        crypto.randomUUID(),
      );
      setMessage(`Period ${period.periodStart} to ${period.periodEnd} was created in state ${period.state}.`);
      setPeriodForm({ periodStart: '', periodEnd: '', periodType: 'MONTHLY' });
      setVersion((current) => current + 1);
    } catch (caught) {
      handle(caught, 'The period was not created.');
    } finally {
      setBusy(false);
    }
  }

  async function closePeriod(period: AccountingPeriod): Promise<void> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await portfolioAccountingAdminApi.closePeriod(period.id, crypto.randomUUID());
      setMessage(`Period ${period.periodStart} to ${period.periodEnd} is closed. Its figures are frozen and cannot be reopened.`);
      setVersion((current) => current + 1);
    } catch (caught) {
      handle(caught, 'The period was not closed. It is still open.');
    } finally {
      setBusy(false);
    }
  }

  async function postAdjustment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!loadedProfile) return;
    const reason = adjustmentForm.reason.trim();
    if (reason.length < 5) {
      setError('Give a reason of at least five characters; the ledger stores it beside the adjustment.');
      return;
    }
    if (adjustmentForm.adjustedAmount.trim() === '' && adjustmentForm.adjustedQuantity.trim() === '') {
      setError('An adjustment needs an amount or a quantity - otherwise it records nothing.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await portfolioAccountingAdminApi.createAdjustment(
        {
          profileId: loadedProfile,
          adjustmentType: adjustmentForm.adjustmentType,
          reason,
          ...(adjustmentForm.adjustedAmount.trim() ? { adjustedAmount: adjustmentForm.adjustedAmount.trim() } : {}),
          ...(adjustmentForm.adjustedQuantity.trim() ? { adjustedQuantity: adjustmentForm.adjustedQuantity.trim() } : {}),
          ...(adjustmentForm.asset.trim() ? { asset: adjustmentForm.asset.trim() } : {}),
          ...(adjustmentForm.originalEventId.trim() ? { originalEventId: adjustmentForm.originalEventId.trim() } : {}),
        },
        crypto.randomUUID(),
      );
      setMessage('The adjustment was posted. It appears in the ledger with your reason attached.');
      setAdjustmentForm({ adjustmentType: 'CORRECTION', reason: '', adjustedAmount: '', adjustedQuantity: '', asset: '', originalEventId: '' });
      setVersion((current) => current + 1);
    } catch (caught) {
      handle(caught, 'The adjustment was not posted.');
    } finally {
      setBusy(false);
    }
  }

  async function runReconciliation(): Promise<void> {
    if (!loadedProfile) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await portfolioAccountingAdminApi.runReconciliation(
        { profileId: loadedProfile, scope: 'TENANT', trigger: 'MANUAL' },
        crypto.randomUUID(),
      );
      setMessage(`A reconciliation pass was recorded (${result.state}).`);
      setVersion((current) => current + 1);
    } catch (caught) {
      handle(caught, 'The reconciliation did not run.');
    } finally {
      setBusy(false);
    }
  }

  const profileRows = accountingRows(profiles.data);
  const cashRows = accountingRows(cash.data);
  const positionRows = accountingRows(positions.data);
  const periodRows = accountingRows(periods.data);

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Profiles" description="An accounting profile fixes the currency, return methodology and cost-basis method for one scope.">
        <form
          onSubmit={(event) => { event.preventDefault(); setLoadedProfile(profileId.trim() || null); }}
          aria-label="Open an accounting profile"
          style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: theme.space(4) }}
        >
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 320 }}>
            Profile id
            <input value={profileId} onChange={(event) => setProfileId(event.target.value)} disabled={busy} />
          </label>
          <button type="submit" disabled={busy}>Open profile</button>
        </form>

        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: `0 0 ${theme.space(3)}`, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
        {error && <ErrorNotice title="Ledger action not completed" message={error} />}

        {profiles.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading profiles…</p>}
        {profiles.error && <ErrorNotice title="Profiles unavailable" message={profiles.error} />}
        {profiles.data && profileRows.length === 0 && <EmptyState title="No profiles" description="A profile must exist before any ledger entry is recorded." />}

        {profileRows.length > 0 && (
          <DataTable
            rows={profileRows}
            rowKey={(row) => row.id}
            emptyTitle="No profiles"
            columns={[
              { key: 'scope', header: 'Scope', render: (row) => `${row.scope} · ${String(row.scopeId).slice(0, 8)}` },
              { key: 'type', header: 'Type', render: (row) => row.portfolioType ?? '—' },
              { key: 'currency', header: 'Currency', render: (row) => row.baseCurrency ?? '—' },
              { key: 'method', header: 'Return method', render: (row) => row.returnMethodology ?? '—' },
              { key: 'cost', header: 'Cost basis', render: (row) => row.costBasisMethod ?? '—' },
              { key: 'created', header: 'Created', render: (row) => (row.createdAt ? formatDateTime(row.createdAt) : '—') },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) => (
                  <button type="button" disabled={busy} onClick={() => { setProfileId(row.id); setLoadedProfile(row.id); }}>Open</button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {loadedProfile && (
        <>
          <Card title="Ledger" description="Cash and positions as the accounting service holds them. Every figure is a decimal string from the service.">
            <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', marginBottom: theme.space(4) }}>
              <StatTile label="Cash assets" value={cashRows.length} />
              <StatTile label="Positions" value={positionRows.length} />
              <StatTile label="Periods" value={periodRows.length} />
              <StatTile label="Open periods" value={periodRows.filter((row) => row.state !== 'CLOSED').length} />
            </div>

            {cash.error && <ErrorNotice title="Cash unavailable" message={cash.error} />}
            {cash.data && (
              <DataTable
                rows={cashRows}
                rowKey={(row, index) => row.id ?? `${row.asset}-${index}`}
                emptyTitle="No cash balances"
                emptyDescription="No cash has been posted to this profile."
                columns={[
                  { key: 'asset', header: 'Asset', render: (row) => row.asset },
                  { key: 'balance', header: 'Balance', align: 'right', render: (row) => formatAmount(row.balance) },
                  { key: 'available', header: 'Available', align: 'right', render: (row) => formatAmount(row.available ?? null) },
                  { key: 'reserved', header: 'Reserved', align: 'right', render: (row) => formatAmount(row.reserved ?? null) },
                  { key: 'asOf', header: 'As of', render: (row) => (row.asOf ? formatDateTime(row.asOf) : '—') },
                ]}
              />
            )}

            <h3 style={{ fontSize: 14, margin: `${theme.space(5)} 0 ${theme.space(3)}` }}>Positions</h3>
            {positions.error && <ErrorNotice title="Positions unavailable" message={positions.error} />}
            {positions.data && (
              <DataTable
                rows={positionRows}
                rowKey={(row) => row.symbol}
                emptyTitle="No positions"
                columns={[
                  { key: 'symbol', header: 'Symbol', render: (row) => row.symbol },
                  { key: 'qty', header: 'Quantity', align: 'right', render: (row) => formatAmount(row.quantity) },
                  { key: 'cost', header: 'Average cost', align: 'right', render: (row) => formatAmount(row.averageCost) },
                  { key: 'value', header: 'Market value', align: 'right', render: (row) => formatAmount(row.marketValue) },
                  { key: 'pnl', header: 'Unrealised P&L', align: 'right', render: (row) => formatAmount(row.unrealizedPnl) },
                ]}
              />
            )}

            <h3 style={{ fontSize: 14, margin: `${theme.space(5)} 0 ${theme.space(3)}` }}>Events</h3>
            {events.error && <ErrorNotice title="Events unavailable" message={events.error} />}
            {events.data && (
              <DataTable
                rows={accountingRows(events.data).slice(0, 25)}
                rowKey={(row) => row.id}
                emptyTitle="No ledger events"
                columns={[
                  { key: 'type', header: 'Event', render: (row) => row.eventType ?? '—' },
                  { key: 'source', header: 'Source', render: (row) => `${row.sourceType ?? '—'} · ${row.sourceId?.slice(0, 8) ?? '—'}` },
                  { key: 'asset', header: 'Asset', render: (row) => row.asset ?? '—' },
                  { key: 'qty', header: 'Quantity', align: 'right', render: (row) => formatAmount(row.quantity ?? null) },
                  { key: 'amount', header: 'Amount', align: 'right', render: (row) => formatAmount(row.amount ?? null) },
                  { key: 'at', header: 'Occurred', render: (row) => (row.occurredAt ? formatDateTime(row.occurredAt) : '—') },
                ]}
              />
            )}
          </Card>

          <Card title="Snapshot" description="A dated, immutable record of NAV. Later figures use it as their base, so it is written once and never edited.">
            <form onSubmit={(event) => void postSnapshot(event)} aria-label="Record a snapshot" style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                Scope
                <select value={snapshotForm.scope} onChange={(event) => setSnapshotForm((current) => ({ ...current, scope: event.target.value }))} disabled={busy}>
                  {ACCOUNTING_SCOPES.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 240 }}>
                Scope id
                <input required value={snapshotForm.scopeId} onChange={(event) => setSnapshotForm((current) => ({ ...current, scopeId: event.target.value }))} disabled={busy} />
              </label>
              <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                Timestamp (optional)
                <input type="datetime-local" value={snapshotForm.timestamp} onChange={(event) => setSnapshotForm((current) => ({ ...current, timestamp: event.target.value }))} disabled={busy} />
              </label>
              <button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record snapshot'}</button>
            </form>

            {closedSnapshot && (
              <p style={{ margin: `${theme.space(3)} 0 0`, fontSize: 13 }}>
                Recorded snapshot <code style={{ fontSize: 12 }}>{closedSnapshot.id.slice(0, 8)}</code> with NAV {formatAmount(closedSnapshot.nav ?? null, { symbol: closedSnapshot.baseCurrency })}.
              </p>
            )}
          </Card>

          <Card title="Periods" description="A period defines the window a statement covers. Closing it freezes every figure inside; there is no reopen route.">
            <form onSubmit={(event) => void postPeriod(event)} aria-label="Create an accounting period" style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: theme.space(4) }}>
              <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                Start
                <input type="date" required value={periodForm.periodStart} onChange={(event) => setPeriodForm((current) => ({ ...current, periodStart: event.target.value }))} disabled={busy} />
              </label>
              <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                End
                <input type="date" required value={periodForm.periodEnd} onChange={(event) => setPeriodForm((current) => ({ ...current, periodEnd: event.target.value }))} disabled={busy} />
              </label>
              <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                Type
                <select value={periodForm.periodType} onChange={(event) => setPeriodForm((current) => ({ ...current, periodType: event.target.value }))} disabled={busy}>
                  {['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM'].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create period'}</button>
            </form>

            {periods.error && <ErrorNotice title="Periods unavailable" message={periods.error} />}
            {periods.data && (
              <DataTable
                rows={periodRows}
                rowKey={(row) => row.id}
                emptyTitle="No periods"
                emptyDescription="Define a period before a statement can be generated."
                columns={[
                  { key: 'window', header: 'Window', render: (row) => `${row.periodStart} → ${row.periodEnd}` },
                  { key: 'type', header: 'Type', render: (row) => row.periodType ?? '—' },
                  { key: 'state', header: 'State', render: (row) => <Badge tone={toneForStatus(row.state)}>{row.state}</Badge> },
                  { key: 'closed', header: 'Closed', render: (row) => (row.closedAt ? formatDateTime(row.closedAt) : 'Open') },
                  {
                    key: 'actions',
                    header: 'Actions',
                    render: (row) =>
                      row.state === 'CLOSED' ? (
                        <span style={{ fontSize: 12, color: theme.color.textMuted }}>Frozen</span>
                      ) : (
                        <button type="button" disabled={busy} onClick={() => void closePeriod(row)}>Close period</button>
                      ),
                  },
                ]}
              />
            )}
          </Card>

          <Card title="Adjustments" description="Corrections to the ledger. A reason is mandatory and travels with the entry.">
            <form onSubmit={(event) => void postAdjustment(event)} aria-label="Post a ledger adjustment" style={{ display: 'grid', gap: theme.space(3), maxWidth: 640, marginBottom: theme.space(4) }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: theme.space(3) }}>
                <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                  Type
                  <select value={adjustmentForm.adjustmentType} onChange={(event) => setAdjustmentForm((current) => ({ ...current, adjustmentType: event.target.value }))} disabled={busy}>
                    {ADJUSTMENT_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                  Asset
                  <input value={adjustmentForm.asset} onChange={(event) => setAdjustmentForm((current) => ({ ...current, asset: event.target.value }))} disabled={busy} />
                </label>
                <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                  Amount (decimal string)
                  <input inputMode="decimal" value={adjustmentForm.adjustedAmount} onChange={(event) => setAdjustmentForm((current) => ({ ...current, adjustedAmount: event.target.value }))} disabled={busy} />
                </label>
                <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                  Quantity (decimal string)
                  <input inputMode="decimal" value={adjustmentForm.adjustedQuantity} onChange={(event) => setAdjustmentForm((current) => ({ ...current, adjustedQuantity: event.target.value }))} disabled={busy} />
                </label>
                <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                  Original event id (optional)
                  <input value={adjustmentForm.originalEventId} onChange={(event) => setAdjustmentForm((current) => ({ ...current, originalEventId: event.target.value }))} disabled={busy} />
                </label>
              </div>
              <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
                Reason
                <textarea required rows={3} value={adjustmentForm.reason} onChange={(event) => setAdjustmentForm((current) => ({ ...current, reason: event.target.value }))} disabled={busy} />
              </label>
              <div>
                <button type="submit" disabled={busy}>{busy ? 'Posting…' : 'Post adjustment'}</button>
              </div>
            </form>

            {adjustments.error && <ErrorNotice title="Adjustments unavailable" message={adjustments.error} />}
            {adjustments.data && (
              <DataTable
                rows={accountingRows(adjustments.data)}
                rowKey={(row) => row.id}
                emptyTitle="No adjustments"
                emptyDescription="Nothing has been corrected on this profile."
                columns={[
                  { key: 'type', header: 'Type', render: (row) => <Badge tone="warning">{row.adjustmentType}</Badge> },
                  { key: 'reason', header: 'Reason', render: (row) => row.reason },
                  { key: 'amount', header: 'Amount', align: 'right', render: (row) => formatAmount(row.adjustedAmount ?? null, { symbol: row.asset ?? undefined }) },
                  { key: 'qty', header: 'Quantity', align: 'right', render: (row) => formatAmount(row.adjustedQuantity ?? null) },
                  { key: 'at', header: 'Posted', render: (row) => (row.createdAt ? formatDateTime(row.createdAt) : '—') },
                ]}
              />
            )}
          </Card>

          <Card
            title="Reconciliation"
            description="Compares the accounting ledger with the source records. A reconciliation records what diverged; it never edits the ledger."
            actions={<button type="button" disabled={busy} onClick={() => void runReconciliation()}>{busy ? 'Running…' : 'Run reconciliation'}</button>}
          >
            {reconciliations.error && <ErrorNotice title="Reconciliations unavailable" message={reconciliations.error} />}
            {reconciliations.data && (
              <DataTable
                rows={accountingRows(reconciliations.data)}
                rowKey={(row) => row.id}
                emptyTitle="No reconciliations"
                emptyDescription="Nothing has been compared for this profile yet."
                columns={[
                  { key: 'state', header: 'State', render: (row) => <Badge tone={toneForStatus(row.state)}>{row.state}</Badge> },
                  { key: 'scope', header: 'Scope', render: (row) => row.scope ?? '—' },
                  { key: 'trigger', header: 'Trigger', render: (row) => row.trigger ?? '—' },
                  { key: 'diff', header: 'Differences', align: 'right', render: (row) => (row.differences === null || row.differences === undefined ? '—' : String(row.differences)) },
                  { key: 'period', header: 'Period', render: (row) => (row.periodId ? String(row.periodId).slice(0, 8) : '—') },
                  { key: 'at', header: 'Ran', render: (row) => (row.createdAt ? formatDateTime(row.createdAt) : '—') },
                ]}
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
