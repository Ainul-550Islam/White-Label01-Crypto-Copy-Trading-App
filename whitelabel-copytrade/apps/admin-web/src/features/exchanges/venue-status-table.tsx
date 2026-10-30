'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import { exchangeAdminApi, exchangeRows, type VenueStatus } from '@/api/exchange-admin-api';
import type { StepUpMethod } from '@/api/developer-platform-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, ErrorNotice } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { StepUpDialog } from '@/features/developer/step-up-dialog';
import { useResource } from '@/features/shared/use-resource';

/**
 * Venue status overrides.
 *
 * An override makes the platform stop routing orders to a venue without waiting
 * for the venue itself to report a fault, so both directions are step-up
 * protected (`VENUE_STATUS_OVERRIDE`). Clearing is not a plain delete: it also
 * asks for a verification, because resuming routing to a venue that is still
 * broken is as consequential as stopping it.
 *
 * A duration is offered but optional. When set, the override lifts itself and
 * the console says so in the row rather than leaving an operator to remember.
 */
const OVERRIDE_STATUSES = ['MAINTENANCE', 'DEGRADED', 'DOWN', 'OPERATIONAL'] as const;

export function VenueStatusTable(): JSX.Element {
  const [version, setVersion] = useState(0);
  const venues = useResource(() => exchangeAdminApi.listVenues(), [version], { errorMessage: 'Venue status could not be loaded.' });

  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ status: 'MAINTENANCE', reason: '', durationMinutes: '' });
  const [pending, setPending] = useState<{ venue: string; kind: 'set' | 'clear'; body?: { status: string; reason: string; durationMinutes?: number }; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  function startSet(row: VenueStatus): void {
    setEditing(row.venue);
    setForm({ status: row.status && OVERRIDE_STATUSES.includes(row.status as (typeof OVERRIDE_STATUSES)[number]) ? row.status : 'MAINTENANCE', reason: '', durationMinutes: '' });
    setError('');
    setMessage('');
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!editing) return;
    const reason = form.reason.trim();
    if (reason.length < 10) {
      setError('Give a reason of at least ten characters; it is shown to operators and kept in the audit trail.');
      return;
    }
    const durationText = form.durationMinutes.trim();
    let durationMinutes: number | undefined;
    if (durationText !== '') {
      if (!/^\d+$/.test(durationText)) {
        setError('A duration must be a whole number of minutes.');
        return;
      }
      durationMinutes = Number.parseInt(durationText, 10);
      if (durationMinutes < 1 || durationMinutes > 10080) {
        setError('A duration must be between 1 minute and 7 days (10080 minutes).');
        return;
      }
    }

    setError('');
    setPending({
      venue: editing,
      kind: 'set',
      body: { status: form.status, reason, ...(durationMinutes === undefined ? {} : { durationMinutes }) },
      key: crypto.randomUUID(),
    });
  }

  async function verify(method: StepUpMethod, value: string): Promise<void> {
    if (!pending) return;
    setBusy(true);
    setVerificationError('');
    try {
      await exchangeAdminApi.requestVenueOverrideProof(method, value, crypto.randomUUID());
    } catch {
      setVerificationError('Verification was not accepted. Try again.');
      setBusy(false);
      return;
    }

    const intent = pending;
    setPending(null);
    try {
      if (intent.kind === 'clear') await exchangeAdminApi.clearVenueStatus(intent.venue, intent.key);
      else if (intent.body) await exchangeAdminApi.setVenueStatus(intent.venue, intent.body, intent.key);
      setMessage(intent.kind === 'clear' ? `${intent.venue} is back to its reported status.` : `${intent.venue} was set to ${intent.body?.status}.`);
      setEditing(null);
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 403
          ? 'You do not have permission to override venue status.'
          : caught instanceof ApiError && caught.status === 409
            ? 'The venue status changed since this page loaded. Reload and check before retrying.'
            : 'The override was not applied. The venue keeps its previous status.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card
        title="Venues"
        description="Reported status per venue, and any operator override in force. Overrides require a verification."
        actions={<button type="button" disabled={venues.loading} onClick={() => setVersion((current) => current + 1)}>Refresh</button>}
      >
        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: `0 0 ${theme.space(3)}`, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
        {error && <ErrorNotice title="Override not applied" message={error} />}
        {venues.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading venues…</p>}
        {venues.error && <ErrorNotice title="Venues unavailable" message={venues.error} />}

        {venues.data && (
          <DataTable
            rows={exchangeRows(venues.data)}
            rowKey={(row) => row.venue}
            emptyTitle="No venues configured"
            emptyDescription="Venues appear here once an exchange connection is enabled for the organisation."
            columns={[
              { key: 'venue', header: 'Venue', render: (row) => <strong style={{ fontSize: 13 }}>{row.venue}</strong> },
              { key: 'status', header: 'Status', render: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
              { key: 'override', header: 'Overridden by', render: (row) => row.overriddenBy ?? '—' },
              { key: 'reason', header: 'Reason', render: (row) => row.reason ?? '—' },
              { key: 'until', header: 'Lifts', render: (row) => (row.overrideUntil ? `${formatDateTime(row.overrideUntil)} (${formatRelative(row.overrideUntil)})` : '—') },
              { key: 'checked', header: 'Updated', render: (row) => formatRelative(row.updatedAt) },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) => (
                  <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
                    <button type="button" disabled={busy} onClick={() => startSet(row)}>Set status</button>
                    {row.overrideUntil || row.overriddenBy ? (
                      <button type="button" disabled={busy} onClick={() => { setMessage(''); setError(''); setPending({ venue: row.venue, kind: 'clear', key: crypto.randomUUID() }); }}>
                        Clear override
                      </button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      {editing && (
        <Card title={`Set status for ${editing}`} description="Pick the status operators should see, and why. The reason is required.">
          <form onSubmit={submit} aria-label={`Set venue status for ${editing}`} style={{ display: 'grid', gap: theme.space(3), maxWidth: 520 }}>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Status
              <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} disabled={busy}>
                {OVERRIDE_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Reason
              <textarea required rows={3} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} disabled={busy} />
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Lifts after (minutes, optional)
              <input inputMode="numeric" value={form.durationMinutes} onChange={(event) => setForm((current) => ({ ...current, durationMinutes: event.target.value }))} disabled={busy} />
            </label>
            <div style={{ display: 'flex', gap: theme.space(2) }}>
              <button type="submit" disabled={busy}>{busy ? 'Applying…' : 'Review and apply'}</button>
              <button type="button" disabled={busy} onClick={() => { setEditing(null); setError(''); }}>Cancel</button>
            </div>
          </form>
        </Card>
      )}

      {pending && (
        <StepUpDialog
          description={
            pending.kind === 'clear'
              ? `Verify your identity to clear the override on ${pending.venue} and resume routing.`
              : `Verify your identity to set ${pending.venue} to ${pending.body?.status}.`
          }
          busy={busy}
          error={verificationError}
          onCancel={() => { setPending(null); setVerificationError(''); }}
          onVerify={verify}
        />
      )}
    </div>
  );
}
