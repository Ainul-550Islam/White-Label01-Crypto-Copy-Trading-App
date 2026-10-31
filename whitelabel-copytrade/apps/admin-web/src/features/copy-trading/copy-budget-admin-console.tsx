// # Responsibility: the operator console for the tenant copy-budget ceiling and the followers at or near it — exact decimal editing, a step-up proof minted at submit time, and a table that never presents a partial page as the whole tenant.
'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import {
  copyBudgetAdminApi,
  isAmountInput,
  type OverCapQuery,
  type OverCapUserRow,
  type TenantDefaultCaps,
} from '@/api/copy-budget-admin-api';
import type { StepUpMethod } from '@/api/developer-platform-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';
import { formatAmount } from '@/features/shared/money';
import { StepUpDialog } from '@/features/developer/step-up-dialog';
import { useResource } from '@/features/shared/use-resource';

/**
 * Tenant copy-budget administration.
 *
 * Two things this screen refuses to do:
 *
 *  * show an amount as a float. Caps arrive and are sent as decimal strings, and
 *    every rendering goes through `formatAmount`, which groups digits without ever
 *    calling `Number`. A cap the operator reads as "1,000.00" must be the string
 *    `"1000.00"` that gets stored.
 *  * present the summary as a tenant-wide figure. The API evaluates one page at a
 *    time, so the tiles are labelled with how many accounts they cover whenever the
 *    page is smaller than the total.
 *
 * The write is the tenant ceiling, which bounds every follower's cap. It is behind
 * a step-up proof minted at submit time (never when the form opens), and the
 * success message quotes the value the API stored rather than the value typed.
 */
type FieldName = 'maxActiveExposure' | 'perTraderCap' | 'currency';

const NEAR_THRESHOLDS = [
  { value: 9_000, label: '90% of cap and above' },
  { value: 8_000, label: '80% of cap and above' },
  { value: 5_000, label: '50% of cap and above' },
] as const;

function statusLabel(caps: TenantDefaultCaps | null): string {
  if (!caps) return 'Unknown';
  switch (caps.status) {
    case 'CONFIGURED':
      return 'Configured';
    case 'NOT_CONFIGURED':
      return 'Not configured';
    case 'CONFIGURATION_UNREADABLE':
      return 'Stored value cannot be read';
    default:
      return 'Unknown';
  }
}

export function CopyBudgetAdminConsole(): JSX.Element {
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<'OVER' | 'NEAR' | undefined>('OVER');
  const [threshold, setThreshold] = useState<number>(9_000);

  const caps = useResource(() => copyBudgetAdminApi.getDefaultCaps(), [version], {
    errorMessage: 'The tenant copy-budget ceiling could not be loaded.',
  });
  const query: OverCapQuery = { status, utilisationBps: threshold, limit: 50 };
  const overCap = useResource(() => copyBudgetAdminApi.listOverCapUsers(query), [status, threshold, version], {
    errorMessage: 'The followers at or above their cap could not be loaded.',
  });

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [pending, setPending] = useState<{ input: { maxActiveExposure: string; perTraderCap: string | null; currency: string }; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [formVersion, setFormVersion] = useState(0);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  const loaded = caps.data?.caps ?? null;
  const rows: OverCapUserRow[] = overCap.data?.data ?? [];
  const total = overCap.data?.total ?? 0;
  const pageIsPartial = total > rows.length;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError('');
    setMessage('');
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const exposure = String(data.get('maxActiveExposure') ?? '').trim();
    const perTrader = String(data.get('perTraderCap') ?? '').trim();
    const currency = String(data.get('currency') ?? '').trim().toUpperCase();

    const next: Partial<Record<FieldName, string>> = {};
    if (!isAmountInput(exposure)) {
      next.maxActiveExposure = 'Enter a plain decimal amount such as 2500.00. Signs and exponents are not accepted.';
    }
    if (perTrader !== '' && !isAmountInput(perTrader)) {
      next.perTraderCap = 'Enter a plain decimal amount such as 500.00, or leave this empty for no per-trader cap.';
    }
    if (!/^[A-Z0-9]{2,12}$/.test(currency)) {
      next.currency = 'Quote asset must be 2-12 letters or digits, for example USDT.';
    }
    // A per-trader cap above the tenant ceiling would be clamped by the ceiling and
    // mislead whoever reads the form back; the API refuses it too.
    if (!next.maxActiveExposure && !next.perTraderCap && perTrader !== '' && isAmountInput(exposure) && isAmountInput(perTrader)) {
      if (compareDecimalStrings(perTrader, exposure) > 0) {
        next.perTraderCap = 'The per-trader cap must not exceed the tenant ceiling.';
      }
    }

    setFieldErrors(next);
    if (Object.keys(next).length > 0) return;

    setPending({
      input: { maxActiveExposure: exposure, perTraderCap: perTrader === '' ? null : perTrader, currency },
      key: crypto.randomUUID(),
    });
  }

  async function verify(method: StepUpMethod, value: string): Promise<void> {
    if (!pending) return;
    setBusy(true);
    setVerificationError('');
    try {
      await copyBudgetAdminApi.requestStepUp(method, value, crypto.randomUUID());
    } catch {
      setVerificationError('Verification was not accepted. Try again.');
      setBusy(false);
      return;
    }

    const intent = pending;
    setPending(null);
    try {
      const result = await copyBudgetAdminApi.setDefaultCaps(intent.input, intent.key);
      const stored = result.caps;
      setMessage(
        stored.maxActiveExposure === null
          ? 'The tenant ceiling was saved, but the stored value could not be read back. Reload before relying on it.'
          : `The tenant ceiling is now ${formatAmount(stored.maxActiveExposure, { symbol: stored.currency ?? '' })}.`,
      );
      setFormVersion((current) => current + 1);
      caps.reload();
      overCap.reload();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        const mapped: Partial<Record<FieldName, string>> = {};
        for (const detail of caught.details ?? []) {
          if (detail.field === 'maxActiveExposure' || detail.field === 'perTraderCap' || detail.field === 'currency') {
            mapped[detail.field] = detail.message;
          }
        }
        setFieldErrors(mapped);
        if (Object.keys(mapped).length === 0) setError(caught.message);
      } else if (caught instanceof ApiError && caught.status === 403) {
        setError('Changing the tenant ceiling requires an administrator and a fresh verification.');
      } else if (caught instanceof ApiError && caught.status >= 500) {
        setError('The ceiling could not be saved. Reload before retrying so a newer change is not overwritten.');
      } else {
        setError('The ceiling was not confirmed. Reload before retrying.');
      }
    } finally {
      setBusy(false);
    }
  }

  const formKey = `${loaded?.updatedAt ?? 'empty'}-${formVersion}`;

  return (
    <div style={{ display: 'grid', gap: theme.space(4) }}>
      <Card
        title="Tenant copy-budget ceiling"
        description="The ceiling bounds the exposure every follower cap resolves to. Changing it requires a verification for this action."
      >
        {caps.loading && (
          <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading the tenant ceiling…</p>
        )}
        {caps.error && <ErrorNotice title="Ceiling unavailable" message={caps.error} />}

        {loaded && (
          <div style={{ display: 'grid', gap: theme.space(3), gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <StatTile
              label="Ceiling"
              value={loaded.maxActiveExposure === null ? 'Not set' : formatAmount(loaded.maxActiveExposure, { symbol: loaded.currency ?? '' })}
            />
            <StatTile label="State" value={statusLabel(loaded)} hint={loaded.status === 'CONFIGURATION_UNREADABLE' ? 'A stored row exists but cannot be parsed. Do not overwrite it blind.' : undefined} />
            <StatTile label="Last change" value={loaded.updatedAt ? formatDateTime(loaded.updatedAt) : 'Never'} />
          </div>
        )}

        <form onSubmit={submit} aria-label="Update the tenant copy-budget ceiling" style={{ display: 'grid', gap: theme.space(3), maxWidth: 520, marginTop: theme.space(4) }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Maximum active exposure
            <input
              key={`exposure-${formKey}`}
              name="maxActiveExposure"
              required
              inputMode="decimal"
              placeholder="2500.00"
              defaultValue={loaded?.maxActiveExposure ?? ''}
              disabled={busy}
              aria-invalid={fieldErrors.maxActiveExposure ? true : undefined}
              aria-describedby={fieldErrors.maxActiveExposure ? 'ceiling-exposure-error' : undefined}
            />
          </label>
          {fieldErrors.maxActiveExposure && (
            <p id="ceiling-exposure-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{fieldErrors.maxActiveExposure}</p>
          )}

          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Per-trader cap (optional)
            <input
              key={`trader-${formKey}`}
              name="perTraderCap"
              inputMode="decimal"
              placeholder="500.00"
              disabled={busy}
              aria-invalid={fieldErrors.perTraderCap ? true : undefined}
              aria-describedby={fieldErrors.perTraderCap ? 'ceiling-trader-error' : 'ceiling-trader-hint'}
            />
          </label>
          <p id="ceiling-trader-hint" style={{ margin: 0, fontSize: 12, color: theme.color.textMuted }}>
            Leave empty for no tenant-wide per-trader cap. A follower&apos;s own per-trader cap still applies.
          </p>
          {fieldErrors.perTraderCap && (
            <p id="ceiling-trader-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{fieldErrors.perTraderCap}</p>
          )}

          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Quote asset
            <input
              key={`currency-${formKey}`}
              name="currency"
              required
              placeholder="USDT"
              defaultValue={loaded?.currency ?? 'USDT'}
              disabled={busy}
              aria-invalid={fieldErrors.currency ? true : undefined}
              aria-describedby={fieldErrors.currency ? 'ceiling-currency-error' : 'ceiling-currency-hint'}
            />
          </label>
          <p id="ceiling-currency-hint" style={{ margin: 0, fontSize: 12, color: theme.color.textMuted }}>
            Changing the quote asset of an existing ceiling is a data migration, not a setting update; the API refuses it.
          </p>
          {fieldErrors.currency && (
            <p id="ceiling-currency-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{fieldErrors.currency}</p>
          )}

          <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: 0, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
          {error && <ErrorNotice title="Ceiling not updated" message={error} />}

          <div style={{ display: 'flex', gap: theme.space(2) }}>
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save ceiling'}</button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setFormVersion((value) => value + 1); caps.reload(); setError(''); setMessage(''); setFieldErrors({}); }}
            >
              Reload
            </button>
          </div>
        </form>
      </Card>

      <Card
        title="Followers at or above their cap"
        description="Each row is computed from the follower's own cap, the tenant ceiling and their active subscription allocations, using the same arithmetic the execution path uses."
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.space(3), marginBottom: theme.space(3) }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Show
            <select value={status ?? ''} onChange={(event) => setStatus(event.target.value === '' ? undefined : (event.target.value as 'OVER' | 'NEAR'))}>
              <option value="OVER">Over the cap</option>
              <option value="NEAR">Near the cap</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Near threshold
            <select value={threshold} onChange={(event) => setThreshold(Number.parseInt(event.target.value, 10))}>
              {NEAR_THRESHOLDS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => overCap.reload()} disabled={overCap.loading}>Reload list</button>
        </div>

        {overCap.loading && (
          <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading followers…</p>
        )}
        {overCap.error && <ErrorNotice title="Followers unavailable" message={overCap.error} />}
        {!overCap.loading && !overCap.error && rows.length === 0 && (
          <EmptyState
            title={status === 'OVER' ? 'No follower is over their cap' : 'No follower is near their cap'}
            description="A follower appears here when their committed allocation exceeds the effective cap, or reaches the threshold you selected."
          />
        )}

        {rows.length > 0 && (
          <>
            {pageIsPartial && (
              <p style={{ margin: '0 0 12px', fontSize: 13, color: theme.color.textMuted }}>
                Showing {rows.length} of {total} matching follower(s). This summary covers the rows shown, not the whole tenant.
              </p>
            )}
            <DataTable
              rows={rows}
              rowKey={(row) => row.userId}
              columns={[
                { key: 'follower', header: 'Follower', render: (row) => row.label ?? row.userId },
                {
                  key: 'state',
                  header: 'State',
                  render: (row) => (
                    <Badge tone={row.state === 'OVER' ? 'danger' : row.state === 'NEAR' ? 'warning' : 'neutral'}>
                      {row.state === 'OVER' ? 'Over cap' : row.state === 'NEAR' ? 'Near cap' : 'Not measurable'}
                    </Badge>
                  ),
                },
                { key: 'cap', header: 'Effective cap', render: (row) => formatAmount(row.effectiveCap, { symbol: row.currency ?? '' }) },
                { key: 'committed', header: 'Committed', render: (row) => formatAmount(row.committed, { symbol: row.currency ?? '', placeholder: 'Not measurable' }) },
                {
                  key: 'utilisation',
                  header: 'Utilisation',
                  render: (row) => (row.utilisationBps === null ? 'Not measurable' : `${(row.utilisationBps / 100).toFixed(2)}%`),
                },
                { key: 'ceiling', header: 'Tenant ceiling', render: (row) => formatAmount(row.tenantCeiling, { symbol: row.currency ?? '', placeholder: 'None' }) },
              ]}
            />
          </>
        )}
      </Card>

      {pending && (
        <StepUpDialog
          description="Saving the tenant ceiling changes what every follower's cap resolves to. Verify to continue."
          busy={busy}
          error={verificationError}
          onCancel={() => { setPending(null); setVerificationError(''); }}
          onVerify={verify}
        />
      )}
    </div>
  );
}

/**
 * Compares two plain decimal strings exactly, without going through `Number`.
 *
 * Both sides have already passed `isAmountInput`, so this only has to line up the
 * integer parts and the fraction parts. Returns -1, 0 or 1.
 */
export function compareDecimalStrings(left: string, right: string): -1 | 0 | 1 {
  const [leftWhole = '0', leftFraction = ''] = left.split('.');
  const [rightWhole = '0', rightFraction = ''] = right.split('.');
  const leftTrimmed = leftWhole.replace(/^0+(?=\d)/, '');
  const rightTrimmed = rightWhole.replace(/^0+(?=\d)/, '');
  if (leftTrimmed.length !== rightTrimmed.length) return leftTrimmed.length < rightTrimmed.length ? -1 : 1;
  if (leftTrimmed !== rightTrimmed) return leftTrimmed < rightTrimmed ? -1 : 1;
  const width = Math.max(leftFraction.length, rightFraction.length);
  const leftScaled = leftFraction.padEnd(width, '0');
  const rightScaled = rightFraction.padEnd(width, '0');
  if (leftScaled === rightScaled) return 0;
  return leftScaled < rightScaled ? -1 : 1;
}
