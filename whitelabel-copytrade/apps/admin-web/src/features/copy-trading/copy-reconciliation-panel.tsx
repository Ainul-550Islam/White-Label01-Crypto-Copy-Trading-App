'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import {
  copyRows,
  copyTradingAdminApi,
  HIGH_WATER_MARK_SCOPES,
  LEADER_FEE_CURRENCIES,
  type CopyReconciliationRecord,
  type LeaderFeePolicy,
  type PortfolioValuation,
} from '@/api/copy-trading-admin-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * Copy-trading reconciliation, leader fees and portfolio valuation.
 *
 * Reconciliation here answers one question: did every follower get the copy the
 * leader's event implied? A record is closed with notes, and closing it never
 * places or cancels an order - the panel says so, because an operator who
 * believes otherwise will stop at the wrong moment.
 *
 * The valuation card reports `executable: false` prominently: the figure exists
 * to size an allocation, not to authorise one.
 */
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

export function CopyReconciliationPanel(): JSX.Element {
  const [version, setVersion] = useState(0);
  const [filters, setFilters] = useState<{ resolved?: boolean; severity?: string; category?: string }>({ resolved: false });
  const [traderId, setTraderId] = useState('');
  const [valuationQuery, setValuationQuery] = useState({ quoteAsset: 'USDT', accountId: '' });
  const [valuation, setValuation] = useState<PortfolioValuation | null>(null);

  const records = useResource(() => copyTradingAdminApi.listReconciliationRecords({ ...filters, limit: 50 }), [filters, version], {
    errorMessage: 'Reconciliation records could not be loaded.',
  });
  const feeHistory = useResource(() => copyTradingAdminApi.getLeaderFeeHistory(traderId.trim()), [traderId, version], {
    enabled: traderId.trim() !== '',
    errorMessage: 'The leader fee history could not be loaded.',
  });

  const [resolving, setResolving] = useState<CopyReconciliationRecord | null>(null);
  const [notes, setNotes] = useState('');
  const [reconRun, setReconRun] = useState('');
  const [feeForm, setFeeForm] = useState({ currency: 'USD', profitShareBps: '', highWaterMarkScope: 'PER_SUBSCRIBER', effectiveFrom: '' });
  const [feePolicy, setFeePolicy] = useState<LeaderFeePolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  async function runReconciliation(): Promise<void> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await copyTradingAdminApi.runReconciliation({ limit: 200 }, crypto.randomUUID());
      const examined = typeof result.examined === 'number' ? result.examined : undefined;
      const found = typeof result.records === 'number' ? result.records : undefined;
      setReconRun(
        examined === undefined
          ? 'A reconciliation pass was recorded. Results appear in the list below.'
          : `Reconciled ${examined} execution(s); ${found ?? 0} record(s) need review.`,
      );
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 403
          ? 'Running reconciliation requires an administrator.'
          : 'The reconciliation did not run. Nothing was compared.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function resolve(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!resolving) return;
    const trimmed = notes.trim();
    if (trimmed.length < 5) {
      setError('Write a note of at least five characters; it becomes the resolution record.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await copyTradingAdminApi.resolveReconciliation(resolving.id, trimmed, crypto.randomUUID());
      setMessage('The record was closed with your note. No order was placed or cancelled by this action.');
      setResolving(null);
      setNotes('');
      setVersion((current) => current + 1);
    } catch {
      setError('The record was not closed.');
    } finally {
      setBusy(false);
    }
  }

  async function saveFee(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (traderId.trim() === '') {
      setError('Enter the trader id whose fee policy you are setting.');
      return;
    }
    const bps = Number.parseInt(feeForm.profitShareBps, 10);
    if (!/^\d+$/.test(feeForm.profitShareBps.trim()) || !Number.isSafeInteger(bps) || bps < 0 || bps > 10000) {
      setError('The profit share must be a whole number of basis points between 0 and 10000.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    const key = crypto.randomUUID();
    try {
      const policy = await copyTradingAdminApi.setLeaderFeePolicy(
        traderId.trim(),
        {
          idempotencyKey: key,
          currency: feeForm.currency,
          profitShareBps: bps,
          highWaterMarkScope: feeForm.highWaterMarkScope,
          ...(feeForm.effectiveFrom ? { effectiveFrom: new Date(feeForm.effectiveFrom).toISOString() } : {}),
        },
        key,
      );
      setFeePolicy(policy);
      setMessage(`The fee policy is set at ${bps} basis points in ${feeForm.currency}.`);
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 403
          ? 'Setting a leader fee requires tenant or platform administration.'
          : 'The fee policy was not changed. The previous policy still applies.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadValuation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const quoteAsset = valuationQuery.quoteAsset.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,16}$/.test(quoteAsset)) {
      setError('Give the quote asset, for example USDT. The API requires one asset rather than a portfolio-wide figure.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await copyTradingAdminApi.getPortfolioValuation(quoteAsset, valuationQuery.accountId.trim() || undefined);
      setValuation(result);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 400
          ? 'The service refused the query: check the quote asset and the account id.'
          : 'The valuation could not be loaded.',
      );
    } finally {
      setBusy(false);
    }
  }

  const recordRows = copyRows<CopyReconciliationRecord>(records.data);
  const unresolved = recordRows.filter((row) => !row.resolved).length;

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Reconciliation posture" description="Whether copies match what the leader's events implied." actions={<button type="button" disabled={busy} onClick={() => void runReconciliation()}>{busy ? 'Running…' : 'Run reconciliation'}</button>}>
        <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', marginBottom: theme.space(3) }}>
          <StatTile label="Records listed" value={recordRows.length} />
          <StatTile label="Unresolved" value={unresolved} hint={unresolved > 0 ? 'Needs a decision' : 'Nothing outstanding'} />
          <StatTile label="Reviewed" value={recordRows.length - unresolved} />
        </div>
        {reconRun && <p role="status" style={{ margin: 0, fontSize: 13 }}>{reconRun}</p>}
      </Card>

      <Card title="Records" description="Each row is a copy that did not match. Closing one records your review; it does not repair the copy.">
        <form
          onSubmit={(event) => event.preventDefault()}
          aria-label="Filter reconciliation records"
          style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: theme.space(4) }}
        >
          <label style={{ display: 'flex', gap: theme.space(2), alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={Boolean(filters.resolved)}
              onChange={(event) => setFilters((current) => ({ ...current, resolved: event.target.checked || undefined }))}
              disabled={records.loading}
            />
            Show closed records
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Severity
            <select value={filters.severity ?? ''} onChange={(event) => setFilters((current) => ({ ...current, severity: event.target.value || undefined }))} disabled={records.loading}>
              <option value="">All</option>
              {SEVERITIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Category
            <input value={filters.category ?? ''} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value || undefined }))} disabled={records.loading} />
          </label>
        </form>

        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: `0 0 ${theme.space(3)}`, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
        {error && <ErrorNotice title="Action not completed" message={error} />}

        {records.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading records…</p>}
        {records.error && <ErrorNotice title="Records unavailable" message={records.error} />}
        {records.data && recordRows.length === 0 && (
          <EmptyState title="No reconciliation records" description="Either every copy matched, or reconciliation has not run yet." />
        )}

        {recordRows.length > 0 && (
          <DataTable
            rows={recordRows}
            rowKey={(row) => row.id}
            emptyTitle="No records"
            columns={[
              { key: 'severity', header: 'Severity', render: (row) => <Badge tone={toneForStatus(row.severity)}>{row.severity}</Badge> },
              { key: 'category', header: 'Category', render: (row) => row.category },
              { key: 'expected', header: 'Expected / actual', render: (row) => (
                <span style={{ fontSize: 12 }}>
                  {row.expected ? JSON.stringify(row.expected).slice(0, 50) : '—'}
                  <br />
                  {row.actual ? JSON.stringify(row.actual).slice(0, 50) : '—'}
                </span>
              ) },
              { key: 'resolved', header: 'State', render: (row) => <Badge tone={row.resolved ? 'success' : 'warning'}>{row.resolved ? 'Closed' : 'Open'}</Badge> },
              { key: 'at', header: 'Found', render: (row) => (row.createdAt ? formatDateTime(row.createdAt) : '—') },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) =>
                  row.resolved ? (
                    <span style={{ fontSize: 12, color: theme.color.textMuted }}>{row.notes ?? 'Reviewed'}</span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => { setResolving(row); setNotes(''); setError(''); setMessage(''); }}>Review</button>
                  ),
              },
            ]}
          />
        )}
      </Card>

      {resolving && (
        <Card title={`Close ${resolving.category}`} description="Your note is the resolution record. This action places and cancels nothing.">
          <form onSubmit={(event) => void resolve(event)} aria-label="Close a reconciliation record" style={{ display: 'grid', gap: theme.space(3), maxWidth: 560 }}>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Notes
              <textarea required rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={busy} />
            </label>
            <div style={{ display: 'flex', gap: theme.space(2) }}>
              <button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record review'}</button>
              <button type="button" disabled={busy} onClick={() => { setResolving(null); setError(''); }}>Back</button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Leader fee policy" description="A profit share in basis points with its high-water-mark scope. Administrative: the previous policy stays in force until this succeeds.">
        <form onSubmit={(event) => void saveFee(event)} aria-label="Set a leader fee policy" style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 280 }}>
            Trader id
            <input value={traderId} onChange={(event) => setTraderId(event.target.value)} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Currency
            <select value={feeForm.currency} onChange={(event) => setFeeForm((current) => ({ ...current, currency: event.target.value }))} disabled={busy}>
              {LEADER_FEE_CURRENCIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 150 }}>
            Profit share (bps)
            <input required inputMode="numeric" value={feeForm.profitShareBps} onChange={(event) => setFeeForm((current) => ({ ...current, profitShareBps: event.target.value }))} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            High-water mark
            <select value={feeForm.highWaterMarkScope} onChange={(event) => setFeeForm((current) => ({ ...current, highWaterMarkScope: event.target.value }))} disabled={busy}>
              {HIGH_WATER_MARK_SCOPES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Effective from (optional)
            <input type="date" value={feeForm.effectiveFrom} onChange={(event) => setFeeForm((current) => ({ ...current, effectiveFrom: event.target.value }))} disabled={busy} />
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Set policy'}</button>
        </form>

        {feePolicy && (
          <p style={{ margin: `${theme.space(3)} 0 0`, fontSize: 13 }}>
            Active policy: {feePolicy.profitShareBps} bps in {feePolicy.currency}, high-water mark {feePolicy.highWaterMarkScope}
            {feePolicy.effectiveFrom ? `, effective ${formatDateTime(feePolicy.effectiveFrom)}` : ''}.
          </p>
        )}

        {traderId.trim() !== '' && (
          <div style={{ marginTop: theme.space(4) }}>
            {feeHistory.error && <ErrorNotice title="Fee history unavailable" message={feeHistory.error} />}
            {feeHistory.data && (
              <DataTable
                rows={copyRows<LeaderFeePolicy>(feeHistory.data)}
                rowKey={(row, index) => `${row.currency}-${row.createdAt ?? index}`}
                emptyTitle="No fee policy history"
                columns={[
                  { key: 'bps', header: 'Profit share', align: 'right', render: (row) => `${row.profitShareBps} bps` },
                  { key: 'currency', header: 'Currency', render: (row) => row.currency },
                  { key: 'hwm', header: 'High-water mark', render: (row) => row.highWaterMarkScope },
                  { key: 'effective', header: 'Effective from', render: (row) => (row.effectiveFrom ? formatDateTime(row.effectiveFrom) : 'Immediately') },
                  { key: 'created', header: 'Recorded', render: (row) => (row.createdAt ? formatDateTime(row.createdAt) : '—') },
                ]}
              />
            )}
          </div>
        )}
      </Card>

      <Card title="Portfolio valuation" description="Persisted valuation for one quote asset. It sizes an allocation; it does not authorise a trade.">
        <form onSubmit={(event) => void loadValuation(event)} aria-label="Load a portfolio valuation" style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Quote asset
            <input required value={valuationQuery.quoteAsset} onChange={(event) => setValuationQuery((current) => ({ ...current, quoteAsset: event.target.value }))} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 280 }}>
            Account id (optional)
            <input value={valuationQuery.accountId} onChange={(event) => setValuationQuery((current) => ({ ...current, accountId: event.target.value }))} disabled={busy} />
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Loading…' : 'Load valuation'}</button>
        </form>

        {valuation && (
          <div style={{ marginTop: theme.space(4), fontSize: 13 }}>
            <p style={{ margin: `0 0 ${theme.space(2)}` }}>
              <Badge tone={valuation.state === 'AVAILABLE' ? 'success' : 'warning'}>{valuation.state}</Badge>{' '}
              Total {formatAmount(valuation.totalValue ?? null, { symbol: valuation.quoteAsset })}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: theme.color.textMuted }}>
              Not executable: {valuation.reason}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
