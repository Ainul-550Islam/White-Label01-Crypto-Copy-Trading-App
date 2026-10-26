// # Responsibility: lets an operator pause or annotate a venue, with a mandatory reason and a step-up proof, and shows what the customer will see.
//
// This console can silence a platform-wide warning for up to a day, so it is
// built to be awkward on purpose:
//
//   * A reason of at least eight characters is required and the button stays
//     disabled until it is there. An override with no reason is unreviewable
//     afterwards - the audit entry would say an operator did something, not why.
//   * UNKNOWN cannot be asserted. The server refuses it and the picker does not
//     offer it: "we do not know" is a statement about our evidence, not a state
//     an operator can impose on a venue.
//   * The expiry is chosen up front and cannot be extended silently. The longest
//     option is a day; past that the operator is guessing about a venue's future.
//   * A step-up proof is a precondition, not a retry. When the server says the
//     proof is missing the console says so and does not re-submit on its own: a
//     silent retry with a stale proof is how an override gets attributed to the
//     wrong operator.
//
// The table shows the customer-visible state next to the platform's internal
// reason, so an operator can see the sentence their override produces before
// pressing anything.
'use client';
import type { JSX } from 'react';

import { useState } from 'react';

import { Badge, Card, DataTable, EmptyState, ErrorNotice } from '@/components/ui';
import { formatDateTime, formatRelative, titleCase } from '@/lib/format';
import { theme, type StatusTone } from '@/lib/theme';

/** The venue states an operator may assert. UNKNOWN is deliberately absent. */
export const ASSERTABLE_VENUE_STATES = ['OPERATIONAL', 'DEGRADED', 'MAINTENANCE', 'OUTAGE'] as const;

export type AssertableVenueState = (typeof ASSERTABLE_VENUE_STATES)[number];

/** Expiries offered by the console, in seconds. The server caps at 86400. */
export const OVERRIDE_TTL_CHOICES: ReadonlyArray<{ seconds: number; label: string }> = [
  { seconds: 900, label: '15 minutes' },
  { seconds: 3_600, label: '1 hour' },
  { seconds: 7_200, label: '2 hours' },
  { seconds: 86_400, label: '24 hours' },
];

/** The minimum the server accepts. The form refuses anything shorter client-side too. */
export const MIN_REASON_LENGTH = 8;
export const MAX_REASON_LENGTH = 300;

export interface VenueOverrideView {
  state: string;
  reason: string;
  setBy: string;
  setAt: string;
  expiresAt: string;
}

export interface VenueStatusRow {
  venue: string;
  /** OPERATIONAL | DEGRADED | MAINTENANCE | OUTAGE | UNKNOWN */
  state: string;
  /** FEED | OVERRIDE | ACCOUNT_HEALTH | NONE - which input decided the answer. */
  source: string;
  /** Why. A closed-vocabulary code, shown as-is so it can be grepped in logs. */
  reason: string;
  /** When the state began. */
  since: string;
  /** False when no first-party evidence stands behind the answer. */
  verified: boolean;
  /** The sentence a customer reads, produced by the customer app. */
  customerMessage: string;
  /** The override in force, if one is. */
  override: VenueOverrideView | null;
  checkedAt: string;
}

export interface VenueStatusConsoleProps {
  rows: VenueStatusRow[];
  /** Venue whose override the operator is editing, or null when nothing is open. */
  editingVenue: string | null;
  onEdit: (venue: string | null) => void;
  /** Rejects when the server refuses; the console renders the message. */
  onSetOverride: (input: {
    venue: string;
    state: AssertableVenueState;
    reason: string;
    ttlSeconds: number;
  }) => Promise<void>;
  onClearOverride: (venue: string) => Promise<void>;
  /** Set when the last write failed, so the reason survives a re-render. */
  error?: string | null;
  /** True while a write is in flight; every control is disabled. */
  busy?: boolean;
  /** True when the server answered 403 with a step-up challenge. */
  stepUpRequired?: boolean;
}

function toneForVenueState(state: string): StatusTone {
  switch (state.toUpperCase()) {
    case 'OPERATIONAL':
      return 'success';
    case 'DEGRADED':
      return 'warning';
    case 'MAINTENANCE':
      return 'warning';
    case 'OUTAGE':
      return 'danger';
    default:
      return 'neutral';
  }
}

function OverrideForm({
  row,
  busy,
  onCancel,
  onSubmit,
}: {
  row: VenueStatusRow;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: { venue: string; state: AssertableVenueState; reason: string; ttlSeconds: number }) => void;
}): JSX.Element {
  const [state, setState] = useState<AssertableVenueState>('MAINTENANCE');
  const [reason, setReason] = useState('');
  const [ttlSeconds, setTtlSeconds] = useState<number>(7_200);

  const trimmed = reason.trim();
  const reasonTooShort = trimmed.length < MIN_REASON_LENGTH;
  const reasonTooLong = trimmed.length > MAX_REASON_LENGTH;
  const canSubmit = !busy && !reasonTooShort && !reasonTooLong;

  return (
    <Card title={`Pause trading on ${titleCase(row.venue)}`}>
      <p style={{ marginTop: 0, color: theme.color.textMuted, fontSize: 13 }}>
        The customer app shows this as the venue’s state until the override expires or is cleared.
        Every write is recorded against your account with the reason below.
      </p>
      <div style={{ display: 'grid', gap: theme.space(3), maxWidth: 640 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: theme.color.textMuted }}>
            State to publish
          </span>
          <select
            value={state}
            onChange={(event) => setState(event.target.value as AssertableVenueState)}
            disabled={busy}
          >
            {ASSERTABLE_VENUE_STATES.map((option) => (
              <option key={option} value={option}>
                {titleCase(option)}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: theme.color.textMuted }}>
            Reason ({MIN_REASON_LENGTH}-{MAX_REASON_LENGTH} characters)
          </span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={MAX_REASON_LENGTH + 40}
            disabled={busy}
            placeholder="What was observed, and where"
          />
          <span
            style={{
              fontSize: 12,
              color: reasonTooLong ? theme.color.danger : theme.color.textMuted,
            }}
          >
            {trimmed.length}/{MAX_REASON_LENGTH}
            {reasonTooShort ? ` - ${MIN_REASON_LENGTH - trimmed.length} more character(s) needed` : ''}
            {reasonTooLong ? ' - shorten this before saving' : ''}
          </span>
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: theme.color.textMuted }}>
            Expires after
          </span>
          <select
            value={String(ttlSeconds)}
            onChange={(event) => setTtlSeconds(Number(event.target.value))}
            disabled={busy}
          >
            {OVERRIDE_TTL_CHOICES.map((choice) => (
              <option key={choice.seconds} value={String(choice.seconds)}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', gap: theme.space(2) }}>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit({ venue: row.venue, state, reason: trimmed, ttlSeconds })}
          >
            {busy ? 'Saving…' : `Publish ${titleCase(state).toLowerCase()}`}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </Card>
  );
}

/**
 * The console. Purely a view over `rows`: the page owns fetching, while every
 * write goes back through the callbacks so the server stays the only authority
 * on what a venue's state is.
 */
export function VenueStatusConsole({
  rows,
  editingVenue,
  onEdit,
  onSetOverride,
  onClearOverride,
  error = null,
  busy = false,
  stepUpRequired = false,
}: VenueStatusConsoleProps): JSX.Element {
  const editingRow = editingVenue ? rows.find((row) => row.venue === editingVenue) ?? null : null;

  return (
    <div style={{ display: 'grid', gap: theme.space(4) }}>
      {stepUpRequired && (
        <ErrorNotice
          title="Confirm your identity to continue"
          message="Pausing a venue needs a fresh identity check. Re-authenticate and try again - the change was not applied."
        />
      )}
      {error && <ErrorNotice title="The change was not applied" message={error} />}

      {rows.length === 0 ? (
        <EmptyState
          title="No venue status available"
          description="The status feed has not reported for any venue yet."
        />
      ) : (
        <Card title="Venue status">
          <DataTable
            rowKey={(row) => row.venue}
            rows={rows}
            columns={[
              {
                key: 'venue',
                header: 'Venue',
                render: (row) => <strong>{titleCase(row.venue)}</strong>,
              },
              {
                key: 'state',
                header: 'Customer sees',
                render: (row) => (
                  <div style={{ display: 'grid', gap: 4 }}>
                    <Badge tone={toneForVenueState(row.state)}>{row.state}</Badge>
                    <span style={{ fontSize: 12, color: theme.color.textMuted }}>{row.customerMessage}</span>
                  </div>
                ),
              },
              {
                key: 'evidence',
                header: 'Evidence',
                render: (row) => (
                  <div style={{ display: 'grid', gap: 2, fontSize: 13 }}>
                    <span>{row.reason}</span>
                    <span style={{ color: theme.color.textMuted }}>
                      {row.source} · {row.verified ? 'confirmed' : 'unconfirmed'}
                    </span>
                    <span style={{ color: theme.color.textMuted }}>since {formatDateTime(row.since)}</span>
                  </div>
                ),
              },
              {
                key: 'override',
                header: 'Override',
                render: (row) =>
                  row.override ? (
                    <div style={{ display: 'grid', gap: 2, fontSize: 13 }}>
                      <Badge tone={toneForVenueState(row.override.state)}>{row.override.state}</Badge>
                      <span>{row.override.reason}</span>
                      <span style={{ color: theme.color.textMuted }}>
                        by {row.override.setBy} · expires {formatRelative(row.override.expiresAt)}
                      </span>
                    </div>
                  ) : (
                    <span style={{ color: theme.color.textMuted, fontSize: 13 }}>None in force</span>
                  ),
              },
              {
                key: 'actions',
                header: 'Actions',
                align: 'right',
                render: (row) => (
                  <div style={{ display: 'flex', gap: theme.space(2), justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onEdit(row.venue === editingVenue ? null : row.venue)}
                    >
                      {row.override ? 'Change override' : 'Pause trading'}
                    </button>
                    {row.override && (
                      <button type="button" disabled={busy} onClick={() => void onClearOverride(row.venue)}>
                        Clear
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
          <p style={{ marginBottom: 0, fontSize: 12, color: theme.color.textMuted }}>
            Status refreshed {rows[0]?.checkedAt ? formatRelative(rows[0].checkedAt) : 'never'}. An
            override never upgrades a venue whose own feed reports a fault: it can only add
            information, not remove it.
          </p>
        </Card>
      )}

      {editingRow && (
        <OverrideForm
          key={editingRow.venue}
          row={editingRow}
          busy={busy}
          onCancel={() => onEdit(null)}
          onSubmit={(input) => void onSetOverride(input)}
        />
      )}
    </div>
  );
}
