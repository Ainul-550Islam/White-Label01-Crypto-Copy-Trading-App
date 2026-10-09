// # Responsibility: shows each exchange account's rate-limit budget, remaining headroom, and pressure, and says plainly when the state is unavailable.
//
// Two things this panel must not do, both because it is the screen an operator checks when orders
// stop moving:
//
//   1. It must not render an unknown budget as a healthy one. `getRateLimitState` returns null when
//      the state cannot be read, and the routing decision refuses in that case - so the panel shows
//      UNKNOWN with the reason, not a bar at zero percent pressure. A dashboard that draws an empty
//      bar for "we could not read this" tells an operator the opposite of what is true.
//   2. It must not invent a limit. `remaining` is nullable server-side and `currentUsage` /
//      `pressure` are reported as measured; when the server withheld a number the cell says so.
'use client';
import type { JSX } from 'react';

import React from 'react';
import { Badge, DataTable } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, type StatusTone } from '@/lib/theme';

export interface ExchangeRateLimitRow {
  accountId: string | null;
  venue: string;
  environment: string;
  endpointClass: string;
  /** Null when the server could not establish the budget. Not the same as zero. */
  currentUsage: number | null;
  /** Null when the server withheld it. */
  remaining: number | null;
  /** 0-100 as measured. Null when unavailable, never defaulted to 0. */
  pressure: number | null;
  isWeightBased: boolean;
  requestsPerInterval: number | null;
  scope: string;
  retryAfterMs: number | null;
  resetAtMs: number | null;
  /** Populated when the state could not be read, so the operator sees why traffic stopped. */
  unavailableReason: string | null;
}

export interface ExchangeRateLimitHealthProps {
  rows: ExchangeRateLimitRow[];
}

/** The server's RateLimitState, as returned by GET /v1/exchanges/rate-limits/:accountId. */
export interface ServerRateLimitState {
  venue: string;
  environment: string;
  accountId: string | null;
  endpointClass: string;
  currentUsage: number;
  remaining: number | null;
  pressure: number;
  isWeightBased: boolean;
  requestsPerInterval: number;
  scope: string;
  retryAfterMs: number | null;
  resetAtMs: number | null;
}

const PRESSURE_WARNING = 70;
const PRESSURE_CRITICAL = 90;

/**
 * The pressure band, or null when the measurement is unavailable. Returning null rather than a
 * default band is the point: an unknown budget has no tone.
 */
export function pressureTone(pressure: number | null): StatusTone | null {
  if (pressure === null || !Number.isFinite(pressure)) return null;
  if (pressure >= PRESSURE_CRITICAL) return 'danger';
  if (pressure >= PRESSURE_WARNING) return 'warning';
  return 'neutral';
}

export function summarizeRateLimitHealth(rows: ReadonlyArray<ExchangeRateLimitRow>): {
  total: number;
  unavailable: number;
  atOrAboveWarning: number;
  worstPressure: number | null;
} {
  let unavailable = 0;
  let atOrAboveWarning = 0;
  let worst: number | null = null;
  for (const row of rows) {
    if (row.pressure === null) {
      unavailable += 1;
      continue;
    }
    if (row.pressure >= PRESSURE_WARNING) atOrAboveWarning += 1;
    worst = worst === null ? row.pressure : Math.max(worst, row.pressure);
  }
  return { total: rows.length, unavailable, atOrAboveWarning, worstPressure: worst };
}

/**
 * Maps the server's state onto a row. A null state becomes an explicit unavailable row rather than
 * a dropped account: an account missing from the panel reads as "not monitored", which is a
 * different and false claim.
 */
export function toRateLimitRow(
  accountId: string | null,
  state: ServerRateLimitState | null,
  fallback: { venue: string; endpointClass: string },
): ExchangeRateLimitRow {
  if (!state) {
    return {
      accountId,
      venue: fallback.venue,
      environment: 'UNKNOWN',
      endpointClass: fallback.endpointClass,
      currentUsage: null,
      remaining: null,
      pressure: null,
      isWeightBased: false,
      requestsPerInterval: null,
      scope: 'UNKNOWN',
      retryAfterMs: null,
      resetAtMs: null,
      unavailableReason: 'The exchange rate-limit state could not be read.',
    };
  }

  return {
    accountId: state.accountId ?? accountId,
    venue: state.venue,
    environment: state.environment,
    endpointClass: state.endpointClass,
    currentUsage: state.currentUsage,
    remaining: state.remaining,
    pressure: state.pressure,
    isWeightBased: state.isWeightBased,
    requestsPerInterval: state.requestsPerInterval,
    scope: state.scope,
    retryAfterMs: state.retryAfterMs,
    resetAtMs: state.resetAtMs,
    unavailableReason: null,
  };
}

function panelStyle(): React.CSSProperties {
  return {
    border: `1px solid ${theme.color.border}`,
    borderRadius: theme.radius.md,
    padding: theme.space(4),
    display: 'grid',
    gap: theme.space(3),
    background: theme.color.surface,
  };
}

export function ExchangeRateLimitHealth({ rows }: ExchangeRateLimitHealthProps): JSX.Element {
  const summary = summarizeRateLimitHealth(rows);
  const muted = { fontSize: 12, color: theme.color.textMuted };
  const unavailableRows = rows.filter((row) => row.unavailableReason);

  return (
    <section style={panelStyle()} aria-label="Exchange rate-limit health" data-testid="exchange-rate-limit-health">
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(2) }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Exchange rate-limit budget</h2>
          <p style={{ ...muted, margin: '4px 0 0' }}>
            Per account and endpoint class over the current minute window. {summary.total} account
            {summary.total === 1 ? '' : 's'} monitored
            {summary.unavailable > 0
              ? `, ${summary.unavailable} with an unreadable budget - routing refuses for those accounts rather than risk a venue ban`
              : ''}
            {summary.atOrAboveWarning > 0 ? `, ${summary.atOrAboveWarning} at or above ${PRESSURE_WARNING}% pressure` : ''}
            .
          </p>
        </div>
        {summary.unavailable > 0 ? <Badge tone="danger">BUDGET UNKNOWN</Badge> : null}
      </header>

      <DataTable<ExchangeRateLimitRow>
        rows={rows}
        rowKey={(row) => `${row.accountId ?? 'global'}:${row.venue}:${row.environment}:${row.endpointClass}`}
        emptyTitle="No exchange accounts are being monitored"
        emptyDescription="This tenant has no exchange accounts reporting a rate-limit budget."
        columns={[
          {
            key: 'account',
            header: 'Account',
            render: (row) => <code style={{ fontSize: 12 }}>{row.accountId ?? 'global'}</code>,
          },
          {
            key: 'venue',
            header: 'Venue',
            render: (row) => (
              <span style={{ fontSize: 12 }}>
                {row.venue} <span style={{ color: theme.color.textMuted }}>({row.environment})</span>
              </span>
            ),
          },
          {
            key: 'endpoint',
            header: 'Endpoint Class',
            render: (row) => (
              <span style={{ fontSize: 12 }}>
                {row.endpointClass}
                {row.isWeightBased ? ' · weighted' : ''}
              </span>
            ),
          },
          {
            key: 'usage',
            header: 'Used / limit',
            render: (row) =>
              row.pressure === null ? (
                <span style={{ fontSize: 12, color: theme.color.danger }}>UNKNOWN</span>
              ) : (
                <span style={{ fontSize: 12 }}>
                  {row.currentUsage} /{' '}
                  {row.requestsPerInterval === null
                    ? 'UNKNOWN'
                    : `${row.requestsPerInterval}${row.isWeightBased ? ' weight/min' : ' req/s'}`}
                </span>
              ),
          },
          {
            key: 'remaining',
            header: 'Remaining',
            render: (row) => (
              <span style={{ fontSize: 12 }}>
                {row.remaining === null ? 'UNKNOWN' : row.remaining}
              </span>
            ),
          },
          {
            key: 'pressure',
            header: 'Pressure',
            // UNKNOWN rather than a zero-width bar: a budget nobody could read is not an empty one.
            render: (row) =>
              row.pressure === null ? (
                <Badge tone="danger">UNKNOWN</Badge>
              ) : (
                <Badge tone={pressureTone(row.pressure) ?? 'neutral'}>{row.pressure}%</Badge>
              ),
          },
          {
            key: 'retry',
            header: 'Retry After',
            render: (row) => <span style={{ fontSize: 12 }}>{row.retryAfterMs === null ? '—' : `${row.retryAfterMs} ms`}</span>,
          },
          {
            key: 'reset',
            header: 'Window Resets',
            render: (row) => (
              <span style={{ fontSize: 12 }}>
                {row.resetAtMs === null ? 'UNKNOWN' : formatDateTime(new Date(row.resetAtMs).toISOString())}
              </span>
            ),
          },
        ]}
      />

      {unavailableRows.length > 0 ? (
        <ul style={{ ...muted, color: theme.color.danger, margin: 0, paddingLeft: theme.space(4) }} data-testid="rate-limit-unavailable-reasons">
          {unavailableRows.map((row) => (
            <li key={`${row.accountId ?? 'global'}:${row.venue}:${row.endpointClass}`}>
              {row.venue} {row.endpointClass} ({row.accountId ?? 'global'}): {row.unavailableReason}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
