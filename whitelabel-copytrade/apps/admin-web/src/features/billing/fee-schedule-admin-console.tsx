// # Responsibility: the operator console for the effective-dated fee schedule — shows what is in force and its ten most recent versions, and publishes the next version behind a step-up proof minted at submit time.
'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import {
  feeScheduleAdminApi,
  formatRatePercent,
  isFeeCurrency,
  isRateInput,
  type EffectiveFeeSchedule,
  type FeeScheduleVersion,
} from '@/api/fee-schedule-admin-api';
import type { StepUpMethod } from '@/api/developer-platform-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';
import { StepUpDialog } from '@/features/developer/step-up-dialog';
import { useResource } from '@/features/shared/use-resource';

/**
 * Fee-schedule administration.
 *
 * The schedule is effective-dated and immutable: publishing a version closes the
 * previous one at the new start and never edits history. Two consequences show up
 * in this screen:
 *
 *  * `effectiveFrom` must be LATER than the most recent version's start, so the
 *    form shows that boundary and pre-fills a moment after it instead of letting
 *    the operator discover a 409;
 *  * the rates are decimal strings that are stored exactly, so the form validates
 *    the same shape the DTO does and never converts them to a number. The
 *    percentage shown beside an input is a display transform of the digits, not
 *    arithmetic on an amount.
 */
type FieldName = 'effectiveFrom' | 'managementFeeRate' | 'profitShareRate' | 'currency';

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  // `datetime-local` wants `YYYY-MM-DDTHH:mm` in local time.
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The earliest instant a new version may start: one minute after the latest one. */
function nextAllowedStart(schedule: EffectiveFeeSchedule | null): string {
  if (!schedule) return toLocalInputValue(new Date(Date.now() + 60 * 60 * 1_000).toISOString());
  const latest = new Date(schedule.effectiveFrom);
  if (!Number.isFinite(latest.getTime())) return '';
  return toLocalInputValue(new Date(latest.getTime() + 60_000).toISOString());
}

export function FeeScheduleAdminConsole(): JSX.Element {
  const [version, setVersion] = useState(0);
  const schedule = useResource(() => feeScheduleAdminApi.getEffective(undefined), [version], {
    errorMessage: 'The fee schedule could not be loaded.',
  });

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [pending, setPending] = useState<{
    input: { effectiveFrom: string; managementFeeRate: string; profitShareRate: string; currency: string };
    key: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [formVersion, setFormVersion] = useState(0);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  const current: EffectiveFeeSchedule | null = schedule.data;
  const versions: FeeScheduleVersion[] = current?.versions ?? [];

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError('');
    setMessage('');
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const effectiveFrom = String(data.get('effectiveFrom') ?? '').trim();
    const managementFeeRate = String(data.get('managementFeeRate') ?? '').trim();
    const profitShareRate = String(data.get('profitShareRate') ?? '').trim();
    const currency = String(data.get('currency') ?? '').trim().toUpperCase();

    const next: Partial<Record<FieldName, string>> = {};
    const startsAt = Date.parse(effectiveFrom);
    if (!effectiveFrom || !Number.isFinite(startsAt)) {
      next.effectiveFrom = 'Choose when the new version takes effect.';
    } else if (current && startsAt <= Date.parse(current.effectiveFrom)) {
      next.effectiveFrom = `Must be later than the latest version's start (${formatDateTime(current.effectiveFrom)}).`;
    }
    if (!isRateInput(managementFeeRate)) {
      next.managementFeeRate = 'Enter a plain decimal rate such as 0.0025. Signs, exponents and leading zeros are not accepted.';
    }
    if (!isRateInput(profitShareRate)) {
      next.profitShareRate = 'Enter a plain decimal rate such as 0.20. Signs, exponents and leading zeros are not accepted.';
    }
    if (!isFeeCurrency(currency)) {
      next.currency = 'Currency must be exactly three upper-case letters, for example USD.';
    }

    setFieldErrors(next);
    if (Object.keys(next).length > 0) return;

    setPending({
      input: { effectiveFrom: new Date(startsAt).toISOString(), managementFeeRate, profitShareRate, currency },
      key: crypto.randomUUID(),
    });
  }

  async function verify(method: StepUpMethod, value: string): Promise<void> {
    if (!pending) return;
    setBusy(true);
    setVerificationError('');
    try {
      await feeScheduleAdminApi.requestStepUp(method, value, crypto.randomUUID());
    } catch {
      setVerificationError('Verification was not accepted. Try again.');
      setBusy(false);
      return;
    }

    const intent = pending;
    setPending(null);
    try {
      const published = await feeScheduleAdminApi.publish(intent.input, intent.key);
      setMessage(
        `Version ${published.version} is published and takes effect ${formatDateTime(published.effectiveFrom)}. Existing versions are closed at that moment, not edited.`,
      );
      setFormVersion((value) => value + 1);
      schedule.reload();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setFieldErrors({ effectiveFrom: caught.message });
      } else if (caught instanceof ApiError && caught.status === 422) {
        const mapped: Partial<Record<FieldName, string>> = {};
        for (const detail of caught.details ?? []) {
          if (detail.field === 'effectiveFrom' || detail.field === 'managementFeeRate' || detail.field === 'profitShareRate' || detail.field === 'currency') {
            mapped[detail.field] = detail.message;
          }
        }
        setFieldErrors(mapped);
        if (Object.keys(mapped).length === 0) setError(caught.message);
      } else if (caught instanceof ApiError && caught.status === 403) {
        setError('Publishing a fee schedule requires a platform administrator and a fresh verification.');
      } else {
        setError('The version was not published. Nothing changed; reload to see the current schedule.');
      }
    } finally {
      setBusy(false);
    }
  }

  const formKey = `${current?.version ?? 'none'}-${formVersion}`;

  return (
    <div style={{ display: 'grid', gap: theme.space(4) }}>
      <Card
        title="Effective fee schedule"
        description="The rates in force now, and the source they come from. A tenant override takes precedence over the platform default."
      >
        {schedule.loading && (
          <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading the fee schedule…</p>
        )}
        {schedule.error && <ErrorNotice title="Fee schedule unavailable" message={schedule.error} />}

        {current && (
          <div style={{ display: 'grid', gap: theme.space(3), gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <StatTile label="Version" value={String(current.version)} />
            <StatTile label="Source" value={<Badge tone={current.source === 'tenant_override' ? 'info' : 'neutral'}>{current.source === 'tenant_override' ? 'Tenant override' : 'Platform default'}</Badge>} />
            <StatTile label="Management fee" value={formatRatePercent(current.managementFeeRate)} hint={`Stored as ${current.managementFeeRate}`} />
            <StatTile label="Profit share" value={formatRatePercent(current.profitShareRate)} hint={`Stored as ${current.profitShareRate}`} />
            <StatTile label="Currency" value={current.currency} />
            <StatTile label="Effective from" value={formatDateTime(current.effectiveFrom)} />
            <StatTile label="Effective until" value={current.effectiveUntil ? formatDateTime(current.effectiveUntil) : 'Open-ended'} />
          </div>
        )}
      </Card>

      <Card title="Version history" description="The ten most recent versions of the scope in force. A published version is never edited; it is closed at the next version's start.">
        {!schedule.loading && !schedule.error && versions.length === 0 && (
          <EmptyState title="No versions recorded" description="No fee schedule has been published for this scope yet." />
        )}
        {versions.length > 0 && (
          <DataTable
            rows={versions}
            rowKey={(row) => String(row.version)}
            columns={[
              { key: 'version', header: 'Version', render: (row) => String(row.version) },
              { key: 'management', header: 'Management fee', render: (row) => formatRatePercent(row.managementFeeRate) },
              { key: 'share', header: 'Profit share', render: (row) => formatRatePercent(row.profitShareRate) },
              { key: 'currency', header: 'Currency', render: (row) => row.currency },
              { key: 'from', header: 'Effective from', render: (row) => formatDateTime(row.effectiveFrom) },
              { key: 'until', header: 'Effective until', render: (row) => (row.effectiveUntil ? formatDateTime(row.effectiveUntil) : 'Open-ended') },
            ]}
          />
        )}
      </Card>

      <Card
        title="Publish the next version"
        description="Publication requires a verification for this action. The new start must be later than the latest version's start."
      >
        <form onSubmit={submit} aria-label="Publish a fee schedule version" style={{ display: 'grid', gap: theme.space(3), maxWidth: 520 }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Effective from
            <input
              key={`from-${formKey}`}
              name="effectiveFrom"
              type="datetime-local"
              required
              defaultValue={nextAllowedStart(current)}
              disabled={busy}
              aria-invalid={fieldErrors.effectiveFrom ? true : undefined}
              aria-describedby={fieldErrors.effectiveFrom ? 'schedule-from-error' : 'schedule-from-hint'}
            />
          </label>
          <p id="schedule-from-hint" style={{ margin: 0, fontSize: 12, color: theme.color.textMuted }}>
            Pre-filled one minute after the latest version&apos;s start. Everything earlier keeps the rates it was billed under.
          </p>
          {fieldErrors.effectiveFrom && (
            <p id="schedule-from-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{fieldErrors.effectiveFrom}</p>
          )}

          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Management fee rate
            <input
              key={`management-${formKey}`}
              name="managementFeeRate"
              required
              inputMode="decimal"
              placeholder="0.0025"
              disabled={busy}
              aria-invalid={fieldErrors.managementFeeRate ? true : undefined}
              aria-describedby={fieldErrors.managementFeeRate ? 'schedule-management-error' : undefined}
            />
          </label>
          {fieldErrors.managementFeeRate && (
            <p id="schedule-management-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{fieldErrors.managementFeeRate}</p>
          )}

          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Profit share rate
            <input
              key={`share-${formKey}`}
              name="profitShareRate"
              required
              inputMode="decimal"
              placeholder="0.20"
              disabled={busy}
              aria-invalid={fieldErrors.profitShareRate ? true : undefined}
              aria-describedby={fieldErrors.profitShareRate ? 'schedule-share-error' : undefined}
            />
          </label>
          {fieldErrors.profitShareRate && (
            <p id="schedule-share-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{fieldErrors.profitShareRate}</p>
          )}

          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Currency
            <input
              key={`currency-${formKey}`}
              name="currency"
              required
              maxLength={3}
              placeholder="USD"
              defaultValue={current?.currency ?? 'USD'}
              disabled={busy}
              aria-invalid={fieldErrors.currency ? true : undefined}
              aria-describedby={fieldErrors.currency ? 'schedule-currency-error' : undefined}
            />
          </label>
          {fieldErrors.currency && (
            <p id="schedule-currency-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{fieldErrors.currency}</p>
          )}

          <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: 0, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
          {error && <ErrorNotice title="Version not published" message={error} />}

          <div style={{ display: 'flex', gap: theme.space(2) }}>
            <button type="submit" disabled={busy}>{busy ? 'Publishing…' : 'Publish version'}</button>
            <button type="button" disabled={busy} onClick={() => { setFormVersion((value) => value + 1); schedule.reload(); setError(''); setMessage(''); setFieldErrors({}); }}>
              Reload
            </button>
          </div>
        </form>
      </Card>

      {pending && (
        <StepUpDialog
          description="Publishing a fee schedule fixes the rates every statement from that moment is billed under. Verify to continue."
          busy={busy}
          error={verificationError}
          onCancel={() => { setPending(null); setVerificationError(''); }}
          onVerify={verify}
        />
      )}
    </div>
  );
}
