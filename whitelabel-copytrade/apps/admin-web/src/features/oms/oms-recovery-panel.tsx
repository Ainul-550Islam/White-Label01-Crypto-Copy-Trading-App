'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import { omsAdminApi, type OrderTimeline } from '@/api/oms-admin-api';
import type { StepUpMethod } from '@/api/developer-platform-api';
import { Badge, Card, DataTable, EmptyState, ErrorNotice } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { StepUpDialog } from '@/features/developer/step-up-dialog';
import { formatAmount } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * Order recovery for stuck or unacknowledged orders.
 *
 * `POST admin/oms/orders/:orderId/recover` is step-up protected with
 * `ORDER_RECOVERY`, and it takes an explicit target state plus a reason. The
 * console therefore:
 *
 *  1. refuses a target outside the OMS state machine that the API documents,
 *  2. refuses a reason shorter than the DTO minimum,
 *  3. asks for the verification immediately before the call, not when the form
 *     opened, and
 *  4. reuses one Idempotency-Key per attempt so a retry cannot move an order
 *     twice.
 */
const KNOWN_STATES = [
  'CREATED',
  'VALIDATED',
  'SUBMITTED',
  'ACKNOWLEDGED',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELED',
  'REJECTED',
  'EXPIRED',
  'RECONCILED',
] as const;

/** Terminal states a recovery may legitimately target; the rest are read-only history. */
const RECOVERABLE_TARGETS = ['ACKNOWLEDGED', 'CANCELED', 'REJECTED', 'EXPIRED', 'RECONCILED'] as const;

export function OmsRecoveryPanel(): JSX.Element {
  const [orderId, setOrderId] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const timeline = useResource(
    () => omsAdminApi.getOrderTimeline(loadedId ?? ''),
    [loadedId],
    { enabled: loadedId !== null, errorMessage: 'The order timeline could not be loaded.' },
  );

  const [form, setForm] = useState<{ targetState: string; reason: string }>({ targetState: 'ACKNOWLEDGED', reason: '' });
  const [errors, setErrors] = useState<{ orderId?: string; targetState?: string; reason?: string }>({});
  const [pending, setPending] = useState<{ orderId: string; targetState: string; reason: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [recovered, setRecovered] = useState<OrderTimeline | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  function load(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const id = orderId.trim();
    if (id === '') {
      setErrors({ orderId: 'Enter the order id to inspect.' });
      return;
    }
    setErrors({});
    setMessage('');
    setError('');
    setRecovered(null);
    setLoadedId(id);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const target = form.targetState;
    const reason = form.reason.trim();
    const next: typeof errors = {};

    if (!(KNOWN_STATES as ReadonlyArray<string>).includes(target)) next.targetState = 'Choose a target state the order service recognises.';
    if (reason.length < 8) next.reason = 'Give a reason of at least eight characters; it is stored with the recovery.';
    if (!(RECOVERABLE_TARGETS as ReadonlyArray<string>).includes(target)) next.targetState = 'That state is not a valid recovery target.';

    setErrors(next);
    if (Object.keys(next).length > 0 || !loadedId) return;

    setError('');
    setMessage('');
    setPending({ orderId: loadedId, targetState: target, reason, key: crypto.randomUUID() });
  }

  async function verify(method: StepUpMethod, value: string): Promise<void> {
    if (!pending) return;
    setBusy(true);
    setVerificationError('');
    try {
      await omsAdminApi.requestRecoveryProof(method, value, crypto.randomUUID());
    } catch {
      setVerificationError('Verification was not accepted. Try again.');
      setBusy(false);
      return;
    }

    const intent = pending;
    setPending(null);
    try {
      const result = await omsAdminApi.recoverOrder(intent.orderId, { targetState: intent.targetState, reason: intent.reason }, intent.key);
      setRecovered(result);
      setMessage(`The order was moved to ${intent.targetState}.`);
      timeline.reload();
    } catch {
      setError('The recovery was not confirmed. Check the order timeline before trying again.');
    } finally {
      setBusy(false);
    }
  }

  const entries = recovered?.entries ?? timeline.data?.entries ?? [];

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Find an order" description="Load an order by its internal id to inspect its recorded state history before recovering it.">
        <form onSubmit={load} aria-label="Load an order timeline" style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 320 }}>
            Order id
            <input
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              disabled={timeline.loading}
              aria-invalid={errors.orderId ? true : undefined}
              aria-describedby={errors.orderId ? 'recovery-order-error' : undefined}
            />
          </label>
          <button type="submit" disabled={timeline.loading}>{timeline.loading ? 'Loading…' : 'Load timeline'}</button>
        </form>
        {errors.orderId && <p id="recovery-order-error" role="alert" style={{ margin: `${theme.space(2)} 0 0`, fontSize: 13, color: theme.color.danger }}>{errors.orderId}</p>}
        {timeline.error && <ErrorNotice title="Timeline unavailable" message={timeline.error} />}
      </Card>

      {loadedId && (
        <Card
          title={`Order ${loadedId.slice(0, 8)}`}
          description={timeline.data ? `${timeline.data.symbol} ${timeline.data.side} · ${formatAmount(timeline.data.quantity)} · currently ${timeline.data.state}` : 'Recorded state history for this order.'}
        >
          {timeline.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading timeline…</p>}
          {timeline.data === null && !timeline.loading && !timeline.error && (
            <EmptyState title="No timeline returned" description="The order may not exist, or it belongs to another organisation." />
          )}
          {entries.length > 0 && (
            <DataTable
              rows={entries}
              rowKey={(row, index) => `${row.state}-${row.at}-${index}`}
              emptyTitle="No state entries"
              columns={[
                { key: 'state', header: 'State', render: (row) => <Badge tone={toneForStatus(row.state)}>{row.state}</Badge> },
                { key: 'at', header: 'At', render: (row) => formatDateTime(row.at) },
                { key: 'actor', header: 'Actor', render: (row) => row.actor || 'System' },
                { key: 'reason', header: 'Reason', render: (row) => row.reason || '—' },
                { key: 'venue', header: 'Venue order', render: (row) => row.venueOrderId ?? '—' },
              ]}
            />
          )}
        </Card>
      )}

      {loadedId && (
        <Card title="Recover this order" description="Moves the order to an explicit terminal state. Requires a verification for this action and a recorded reason.">
          <form onSubmit={submit} aria-label="Recover an order" style={{ display: 'grid', gap: theme.space(3), maxWidth: 560 }}>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Target state
              <select
                value={form.targetState}
                onChange={(event) => setForm((current) => ({ ...current, targetState: event.target.value }))}
                disabled={busy}
                aria-invalid={errors.targetState ? true : undefined}
              >
                {RECOVERABLE_TARGETS.map((state) => <option key={state} value={state}>{state}</option>)}
              </select>
            </label>
            {errors.targetState && <p role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{errors.targetState}</p>}

            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Reason
              <textarea
                required
                rows={3}
                value={form.reason}
                onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
                disabled={busy}
                aria-invalid={errors.reason ? true : undefined}
              />
            </label>
            {errors.reason && <p role="alert" style={{ margin: 0, fontSize: 13, color: theme.color.danger }}>{errors.reason}</p>}

            <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: 0, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
            {error && <ErrorNotice title="Recovery not confirmed" message={error} />}

            {/* Triggers the verification dialog; the mutation only fires after it. */}
            <div>
              <button type="submit" disabled={busy}>{busy ? 'Recovering…' : 'Review and recover'}</button>
            </div>
          </form>
        </Card>
      )}

      {pending && (
        <StepUpDialog
          description={`Recover order ${pending.orderId.slice(0, 8)} to ${pending.targetState}. This verification is single-use.`}
          busy={busy}
          error={verificationError}
          onCancel={() => { setPending(null); setVerificationError(''); }}
          onVerify={verify}
        />
      )}
    </div>
  );
}
