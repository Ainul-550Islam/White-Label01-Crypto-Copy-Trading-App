'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import { riskAdminApi, type UserPositionLimits } from '@/api/risk-admin-api';
import type { StepUpMethod } from '@/api/developer-platform-api';
import { ApiError } from '@/lib/api-error';
import { Card, ErrorNotice } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';
import { StepUpDialog } from '@/features/developer/step-up-dialog';
import { useResource } from '@/features/shared/use-resource';

/**
 * The caller's own position limits.
 *
 * `PUT risk-management/my-position-limits` is step-up protected
 * (`USER_POSITION_LIMIT_UPDATE`) and the DTO bounds both integers, so the form
 * validates before it sends and maps a 409/422 back to the field that caused it
 * rather than showing a generic failure:
 *
 *  * 409 - someone else changed the limits since this page loaded (`expectedUpdatedAt`
 *    no longer matches). The fix is to reload, not to retype.
 *  * 422 - the API refused a value; its `details` name the field.
 */
const MIN_LIMIT = 1;
const MAX_LIMIT = 1000;

type FieldName = 'maxConcurrentPositions' | 'maxOpenOrders';

function parseLimit(value: string, label: string): { value?: number; error?: string } {
  const trimmed = value.trim();
  if (trimmed === '') return { error: `${label} is required.` };
  // Integers only: a decimal would be truncated by the API's IsInt and silently
  // change the limit the operator thought they set.
  if (!/^\d+$/.test(trimmed)) return { error: `${label} must be a whole number.` };
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_LIMIT || parsed > MAX_LIMIT) {
    return { error: `${label} must be between ${MIN_LIMIT} and ${MAX_LIMIT}.` };
  }
  return { value: parsed };
}

export function PositionLimitForm(): JSX.Element {
  const limits = useResource(() => riskAdminApi.getMyPositionLimits(), [], { errorMessage: 'Your position limits could not be loaded.' });

  // The inputs are uncontrolled and re-mounted (`key`) when a fresh row arrives,
  // so new server values seed the form without an effect writing state during
  // render - and an operator's typing is never clobbered by a background reload.
  const [formVersion, setFormVersion] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [staleNotice, setStaleNotice] = useState(false);
  const [pending, setPending] = useState<{ body: { maxConcurrentPositions: number; maxOpenOrders: number; expectedUpdatedAt?: string }; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  const loaded: UserPositionLimits | null = limits.data;
  const formKey = `${loaded?.updatedAt ?? 'empty'}-${formVersion}`;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError('');
    setMessage('');
    setStaleNotice(false);

    const data = new FormData(event.currentTarget);
    const positions = parseLimit(String(data.get('maxConcurrentPositions') ?? ''), 'Maximum concurrent positions');
    const orders = parseLimit(String(data.get('maxOpenOrders') ?? ''), 'Maximum open orders');
    const next: Partial<Record<FieldName, string>> = {};
    if (positions.error) next.maxConcurrentPositions = positions.error;
    if (orders.error) next.maxOpenOrders = orders.error;

    setFieldErrors(next);
    if (Object.keys(next).length > 0 || positions.value === undefined || orders.value === undefined) return;

    setPending({
      body: {
        maxConcurrentPositions: positions.value,
        maxOpenOrders: orders.value,
        ...(loaded?.updatedAt ? { expectedUpdatedAt: loaded.updatedAt } : {}),
      },
      key: crypto.randomUUID(),
    });
  }

  async function verify(method: StepUpMethod, value: string): Promise<void> {
    if (!pending) return;
    setBusy(true);
    setVerificationError('');
    try {
      await riskAdminApi.requestPositionLimitProof(method, value, crypto.randomUUID());
    } catch {
      setVerificationError('Verification was not accepted. Try again.');
      setBusy(false);
      return;
    }

    const intent = pending;
    setPending(null);
    try {
      await riskAdminApi.updateMyPositionLimits(intent.body, intent.key);
      setMessage('Your position limits were updated.');
      limits.reload();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setStaleNotice(true);
      } else if (caught instanceof ApiError && caught.status === 422) {
        const mapped: Partial<Record<FieldName, string>> = {};
        for (const detail of caught.details ?? []) {
          if (detail.field === 'maxConcurrentPositions' || detail.field === 'maxOpenOrders') mapped[detail.field] = detail.message;
        }
        setFieldErrors(mapped);
        if (Object.keys(mapped).length === 0) setError('The limits were refused. Check the values and try again.');
      } else if (caught instanceof ApiError && caught.status === 403) {
        setError('You do not have permission to change your position limits.');
      } else {
        setError('The update was not confirmed. Reload before retrying so you do not overwrite a newer change.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="My position limits" description="These limits apply to your own account. Changing them requires a verification for this action.">
      {limits.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading your limits…</p>}
      {limits.error && <ErrorNotice title="Limits unavailable" message={limits.error} />}

      {loaded && (
        <p style={{ marginTop: 0, fontSize: 13, color: theme.color.textMuted }}>
          Current: {loaded.maxConcurrentPositions ?? 'not set'} concurrent positions, {loaded.maxOpenOrders ?? 'not set'} open orders.
          {loaded.updatedAt ? ` Last updated ${formatDateTime(loaded.updatedAt)}.` : ''}
        </p>
      )}

      <form onSubmit={submit} aria-label="Update my position limits" style={{ display: 'grid', gap: theme.space(3), maxWidth: 480 }}>
        <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
          Maximum concurrent positions
          <input
            key={`positions-${formKey}`}
            name="maxConcurrentPositions"
            required
            inputMode="numeric"
            defaultValue={loaded?.maxConcurrentPositions === null || loaded?.maxConcurrentPositions === undefined ? '' : String(loaded.maxConcurrentPositions)}
            disabled={busy || limits.loading}
            aria-invalid={fieldErrors.maxConcurrentPositions ? true : undefined}
            aria-describedby={fieldErrors.maxConcurrentPositions ? 'positions-error' : undefined}
          />
        </label>
        {fieldErrors.maxConcurrentPositions && (
          <p id="positions-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{fieldErrors.maxConcurrentPositions}</p>
        )}

        <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
          Maximum open orders
          <input
            key={`orders-${formKey}`}
            name="maxOpenOrders"
            required
            inputMode="numeric"
            defaultValue={loaded?.maxOpenOrders === null || loaded?.maxOpenOrders === undefined ? '' : String(loaded.maxOpenOrders)}
            disabled={busy || limits.loading}
            aria-invalid={fieldErrors.maxOpenOrders ? true : undefined}
            aria-describedby={fieldErrors.maxOpenOrders ? 'orders-error' : undefined}
          />
        </label>
        {fieldErrors.maxOpenOrders && (
          <p id="orders-error" role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{fieldErrors.maxOpenOrders}</p>
        )}

        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: 0, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>

        {staleNotice && (
          <ErrorNotice
            title="These limits changed elsewhere"
            message="Someone updated your limits while this page was open. Reload to see the current values before saving again."
          />
        )}
        {error && <ErrorNotice title="Limits not updated" message={error} />}

        <div style={{ display: 'flex', gap: theme.space(2) }}>
          <button type="submit" disabled={busy || limits.loading}>{busy ? 'Saving…' : 'Save limits'}</button>
          <button type="button" disabled={busy} onClick={() => { setFormVersion((value) => value + 1); limits.reload(); setStaleNotice(false); setMessage(''); setError(''); }}>Reload</button>
        </div>
      </form>

      {pending && (
        <StepUpDialog
          description="Verify your identity to change your position limits. This verification is single-use."
          busy={busy}
          error={verificationError}
          onCancel={() => { setPending(null); setVerificationError(''); }}
          onVerify={verify}
        />
      )}
    </Card>
  );
}
