'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import { riskAdminApi, riskRows, type DailyPnlPoint, type RiskPolicy } from '@/api/risk-admin-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { compareAmounts, formatAmount, isDecimalString } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/** `risk/accounts/:accountId/limits/rollback` demands this phrase in `confirm`. */
const ROLLBACK_CONFIRMATION = 'ROLLBACK RISK LIMITS';

/**
 * A single account's risk view plus its limit history.
 *
 * The limits endpoints post an opaque object (`Record<string, unknown>`), so the
 * editor is a JSON field validated locally. The rollback is a separate form
 * because it needs three distinct inputs the API validates: the version to
 * return to, a change reason, and the typed confirmation phrase. Rolling limits
 * back silently loosens controls, so the phrase is not pre-filled from the
 * version number or copied from the reason.
 */
export function AccountRiskPanel({ accountId }: { accountId: string }): JSX.Element {
  const [version, setVersion] = useState(0);
  const summary = useResource(() => riskAdminApi.getAccountSummary(accountId), [accountId, version], { errorMessage: 'The account summary could not be loaded.' });
  const margin = useResource(() => riskAdminApi.getMargin(accountId), [accountId, version], { errorMessage: 'Margin could not be loaded.' });
  const leverage = useResource(() => riskAdminApi.getLeverage(accountId), [accountId, version], { errorMessage: 'Leverage could not be loaded.' });
  const liquidation = useResource(() => riskAdminApi.getLiquidation(accountId), [accountId, version], { errorMessage: 'Liquidation levels could not be loaded.' });
  const projection = useResource(() => riskAdminApi.getAccountExposureProjection(accountId), [accountId, version], { errorMessage: 'Exposure projection could not be loaded.' });
  const pnl = useResource(() => riskAdminApi.getDailyPnl(accountId), [accountId, version], { errorMessage: 'Daily P&L could not be loaded.' });
  const limits = useResource(() => riskAdminApi.getAccountLimits(accountId), [accountId, version], { errorMessage: 'Account limits could not be loaded.' });

  const [limitsJson, setLimitsJson] = useState('');
  const [limitsReason, setLimitsReason] = useState('');
  const [rollback, setRollback] = useState({ toVersion: '', changeReason: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [seededFor, setSeededFor] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  const seedIdentity = limits.data ? `${accountId}:${limits.data.version}` : '';
  if (seedIdentity !== '' && seedIdentity !== seededFor) {
    setSeededFor(seedIdentity);
    setLimitsJson(JSON.stringify(limits.data?.thresholds ?? {}, null, 2));
  }

  function parseLimits(text: string): { value?: Record<string, unknown>; error?: string } {
    const trimmed = text.trim();
    if (trimmed === '') return { error: 'The limits cannot be empty.' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { error: 'The limits are not valid JSON.' };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed as Record<string, unknown>).length === 0) {
      return { error: 'Send a JSON object with at least one limit.' };
    }
    return { value: parsed as Record<string, unknown> };
  }

  async function saveLimits(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    setMessage('');
    const parsed = parseLimits(limitsJson);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    if (limitsReason.trim().length < 10) {
      setError('Give a change reason of at least ten characters.');
      return;
    }

    setBusy(true);
    try {
      const saved = await riskAdminApi.updateAccountLimits(accountId, { ...parsed.value, changeReason: limitsReason.trim(), expectedVersion: limits.data?.version }, crypto.randomUUID());
      setMessage(`Limits saved as version ${saved.version}.`);
      setLimitsReason('');
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 409
          ? 'The limits changed elsewhere. Reload before saving again.'
          : caught instanceof ApiError && caught.status === 403
            ? 'You do not have permission to change this account’s limits.'
            : 'The limits were not saved. The previous version is still enforced.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function rollbackLimits(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    setMessage('');
    const toVersion = Number.parseInt(rollback.toVersion.trim(), 10);
    if (!Number.isSafeInteger(toVersion) || toVersion < 1) {
      setError('Choose the version number to roll back to.');
      return;
    }
    if (rollback.changeReason.trim().length < 10) {
      setError('Give a rollback reason of at least ten characters.');
      return;
    }
    if (rollback.confirm.trim() !== ROLLBACK_CONFIRMATION) {
      setError(`Type ${ROLLBACK_CONFIRMATION} exactly to roll back.`);
      return;
    }

    setBusy(true);
    try {
      const saved = await riskAdminApi.rollbackAccountLimits(
        accountId,
        { toVersion, changeReason: rollback.changeReason.trim(), confirm: rollback.confirm.trim() },
        crypto.randomUUID(),
      );
      setMessage(`Limits rolled back; now at version ${saved.version}.`);
      setRollback({ toVersion: '', changeReason: '', confirm: '' });
      setVersion((current) => current + 1);
    } catch {
      setError('The rollback was not applied. Limits are unchanged.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Account posture" description="Margin, leverage and liquidation for this account.">
        {summary.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading account risk…</p>}
        {summary.error && <ErrorNotice title="Account summary unavailable" message={summary.error} />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: theme.space(3) }}>
          <StatTile label="Margin used" value={formatAmount(margin.data?.marginUsed ?? null)} />
          <StatTile label="Margin available" value={formatAmount(margin.data?.marginAvailable ?? null)} />
          {/* Compared as decimal strings: `Number('0.8000000000000000001') > 0.8` is a float rounding
              question, not the question an operator is asking. */}
          <StatTile
            label="Margin ratio"
            value={margin.data?.marginRatio ?? 'Not available'}
            hint={
              margin.data?.marginRatio && isDecimalString(margin.data.marginRatio) && compareAmounts(margin.data.marginRatio, '0.8') > 0
                ? 'Above 80% of maintenance'
                : undefined
            }
          />
          <StatTile label="Effective leverage" value={leverage.data?.effectiveLeverage ?? 'Not available'} hint={leverage.data?.maxLeverage ? `Cap ${leverage.data.maxLeverage}` : undefined} />
          <StatTile label="Gross exposure" value={formatAmount(projection.data?.totalExposure ?? null)} />
          <StatTile label="Net exposure" value={formatAmount(projection.data?.netExposure ?? null)} />
        </div>
        {leverage.data && leverage.data.allowed === false && (
          <ErrorNotice title="Leverage not permitted" message={leverage.data.reason ?? 'The risk service refuses this leverage for the account. Reduce it before placing new orders.'} />
        )}
      </Card>

      <Card title="Liquidation distance" description="How far each position is from liquidation. An unknown distance is shown as unknown.">
        {liquidation.error && <ErrorNotice title="Liquidation levels unavailable" message={liquidation.error} />}
        {liquidation.data && liquidation.data.positions.length === 0 && <EmptyState title="No open positions" description="Nothing is exposed to liquidation." />}
        {liquidation.data && liquidation.data.positions.length > 0 && (
          <DataTable
            rows={liquidation.data.positions}
            rowKey={(row) => row.symbol}
            emptyTitle="No positions"
            columns={[
              { key: 'symbol', header: 'Symbol', render: (row) => row.symbol },
              { key: 'side', header: 'Side', render: (row) => row.side ?? '—' },
              { key: 'liq', header: 'Liquidation price', align: 'right', render: (row) => formatAmount(row.liquidationPrice) },
              { key: 'distance', header: 'Distance', align: 'right', render: (row) => (row.distancePercent === null ? 'Not available' : `${row.distancePercent}%`) },
            ]}
          />
        )}
      </Card>

      <Card title="Daily P&L" description="Equity and realised net P&L per day, as the risk service recorded it.">
        {pnl.error && <ErrorNotice title="Daily P&L unavailable" message={pnl.error} />}
        {pnl.data && (
          <DataTable
            rows={riskRows<DailyPnlPoint>(pnl.data).slice(-30).reverse()}
            rowKey={(row) => row.at}
            emptyTitle="No daily P&L yet"
            columns={[
              { key: 'at', header: 'Day', render: (row) => formatDateTime(row.at) },
              { key: 'equity', header: 'Equity', align: 'right', render: (row) => formatAmount(row.equity) },
              { key: 'net', header: 'Net P&L', align: 'right', render: (row) => formatAmount(row.netPnl) },
            ]}
          />
        )}
      </Card>

      <Card title="Account limits" description={`Version ${limits.data?.version ?? '—'} is currently enforced. Saving requires a reason and refuses to overwrite a newer version.`}>
        {limits.error && <ErrorNotice title="Limits unavailable" message={limits.error} />}
        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: `0 0 ${theme.space(3)}`, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
        {error && <ErrorNotice title="Limits not changed" message={error} />}

        {limits.data && (
          <form onSubmit={(event) => void saveLimits(event)} aria-label="Update account limits" style={{ display: 'grid', gap: theme.space(3), marginBottom: theme.space(6) }}>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Limits (JSON object)
              <textarea rows={10} spellCheck={false} value={limitsJson} onChange={(event) => setLimitsJson(event.target.value)} disabled={busy} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }} />
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, maxWidth: 520 }}>
              Change reason
              <input required value={limitsReason} onChange={(event) => setLimitsReason(event.target.value)} disabled={busy} />
            </label>
            <div>
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save limits'}</button>
            </div>
          </form>
        )}

        <h3 style={{ fontSize: 14, margin: `0 0 ${theme.space(3)}` }}>Roll back to a previous version</h3>
        <form onSubmit={(event) => void rollbackLimits(event)} aria-label="Roll back account limits" style={{ display: 'grid', gap: theme.space(3), maxWidth: 520 }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Target version
            <input required inputMode="numeric" value={rollback.toVersion} onChange={(event) => setRollback((current) => ({ ...current, toVersion: event.target.value }))} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Rollback reason
            <input required value={rollback.changeReason} onChange={(event) => setRollback((current) => ({ ...current, changeReason: event.target.value }))} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Type {ROLLBACK_CONFIRMATION} to confirm
            <input required value={rollback.confirm} onChange={(event) => setRollback((current) => ({ ...current, confirm: event.target.value }))} disabled={busy} />
          </label>
          <div>
            <button type="submit" disabled={busy}>{busy ? 'Rolling back…' : 'Roll back limits'}</button>
          </div>
        </form>
      </Card>

      <Card title="Strategy summary" description="Limits history for this account, newest first.">
        {limits.data && (
          <p style={{ marginTop: 0, fontSize: 13, color: theme.color.textMuted }}>
            <Badge tone={toneForStatus('ACTIVE')}>v{limits.data.version}</Badge>{' '}
            {Object.keys((limits.data as RiskPolicy).thresholds ?? {}).join(', ') || 'No thresholds set'}
          </p>
        )}
        {limits.data?.createdAt && <p style={{ margin: 0, fontSize: 13, color: theme.color.textMuted }}>Last saved {formatDateTime(limits.data.createdAt)}.</p>}
      </Card>
    </div>
  );
}
