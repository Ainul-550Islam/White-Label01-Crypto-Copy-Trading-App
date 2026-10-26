// # Responsibility: operator table of every exchange account's user-data stream state, how long since its last event, and the venue clock skew that gates signed requests.
//
// WHAT THIS PANEL IS FOR
// ----------------------
// A user-data stream that has silently died is invisible from the customer side:
// orders still place, so nothing looks wrong until a fill arrives that the platform
// never saw. This table makes the silence visible. Three decisions follow:
//
//   * UNKNOWN is rendered as its own state, never as CONNECTED. It means "no
//     evidence", which happens when the engine cannot be reached - precisely the
//     case where a green light would be a lie.
//   * The event age is shown as an absolute age, not a timestamp alone, because the
//     operator's question is "how stale", and computing it from a clock is exactly
//     the step that goes wrong across timezones.
//   * Rows are ordered worst-first, so the accounts that need attention are at the
//     top without the operator having to sort or read 900 rows.
'use client';
import type { JSX } from 'react';

import { useEffect, useState } from 'react';

import {
  executionAdminApi,
  type StreamHealthRow,
  type StreamState,
} from '@/api/execution-admin-api';

const STATE_WEIGHT: Record<StreamState, number> = {
  UNKNOWN: 4,
  DISCONNECTED: 3,
  DEGRADED: 2,
  CONNECTED: 1,
};

const STATE_STYLE: Record<StreamState, { background: string; border: string; color: string }> = {
  CONNECTED: { background: '#ecfdf5', border: '#6ee7b7', color: '#065f46' },
  DEGRADED: { background: '#fffbeb', border: '#fcd34d', color: '#92400e' },
  DISCONNECTED: { background: '#fef2f2', border: '#fca5a5', color: '#991b1b' },
  // Dashed border: "we have not measured this" must not look like a measured state.
  UNKNOWN: { background: '#f8fafc', border: '#cbd5e1', color: '#334155' },
};

const REASON_TEXT: Record<string, string> = {
  NO_EVIDENCE: 'The engine did not report a state for this account.',
  ENGINE_UNREACHABLE: 'The execution engine could not be reached.',
  STREAM_SILENT: 'The stream is open but has sent no events for too long.',
  LISTEN_KEY_EXPIRING: 'The listen key is close to expiry; the stream will need re-subscribing.',
  LISTEN_KEY_EXPIRED: 'The listen key has expired, so the stream cannot be trusted.',
  SOCKET_CLOSED: 'The websocket is closed.',
  RECONNECTING: 'The stream is reconnecting.',
  HEALTHY: 'The stream is connected and current.',
};

function formatAge(ms: number | null): string {
  if (ms === null) return 'never';
  if (ms < 1_000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export interface ExchangeStreamHealthProps {
  /** Server-rendered first paint; the component refreshes from the browser after that. */
  initialRows: StreamHealthRow[];
  refreshMs?: number;
  /** Shown when the server could not load the first page at all. */
  initialError?: string | null;
}

export function ExchangeStreamHealth({
  initialRows,
  refreshMs = 30_000,
  initialError = null,
}: ExchangeStreamHealthProps): JSX.Element {
  const [rows, setRows] = useState<StreamHealthRow[]>(initialRows);
  const [error, setError] = useState<string | null>(initialError);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(() => {
      void executionAdminApi
        .listStreamHealth()
        .then((next) => {
          if (cancelled) return;
          setRows(next);
          setError(null);
          setRefreshedAt(new Date().toISOString());
        })
        .catch((failure: unknown) => {
          if (cancelled) return;
          // The last known rows stay on screen; the error says they may be stale.
          setError(failure instanceof Error ? failure.message : 'Stream health could not be refreshed.');
        });
    }, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshMs]);

  const ordered = [...rows].sort((a, b) => {
    const byState = STATE_WEIGHT[b.state] - STATE_WEIGHT[a.state];
    if (byState !== 0) return byState;
    return (b.lastEventAgeMs ?? Number.MAX_SAFE_INTEGER) - (a.lastEventAgeMs ?? Number.MAX_SAFE_INTEGER);
  });

  const disconnected = ordered.filter((row) => row.state === 'DISCONNECTED').length;
  const unknown = ordered.filter((row) => row.state === 'UNKNOWN').length;
  const degraded = ordered.filter((row) => row.state === 'DEGRADED').length;

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>User-data stream health</h2>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {ordered.length} account{ordered.length === 1 ? '' : 's'} · {degraded} degraded · {disconnected} disconnected ·{' '}
          {unknown} unknown
          {refreshedAt ? ` · refreshed ${new Date(refreshedAt).toLocaleTimeString()}` : ''}
        </span>
      </header>

      {error && (
        <p
          role="alert"
          style={{ margin: 0, padding: '8px 12px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: 13 }}
        >
          {error} The rows below are the last state we could read.
        </p>
      )}

      {unknown > 0 && (
        <p style={{ margin: 0, fontSize: 12, color: '#475569' }}>
          Accounts marked UNKNOWN are not being reported on at all. That is not the same as healthy: check that the engine
          is running before treating those accounts as connected.
        </p>
      )}

      {ordered.length === 0 ? (
        <p style={{ margin: 0, padding: 12, borderRadius: 6, border: '1px dashed #cbd5e1', fontSize: 13, color: '#475569' }}>
          No exchange accounts are reporting a stream.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#475569' }}>
                <th style={{ padding: '6px 8px' }}>Account</th>
                <th style={{ padding: '6px 8px' }}>Venue</th>
                <th style={{ padding: '6px 8px' }}>Stream</th>
                <th style={{ padding: '6px 8px' }}>Last event</th>
                <th style={{ padding: '6px 8px' }}>Reconnects</th>
                <th style={{ padding: '6px 8px' }}>Listen key</th>
                <th style={{ padding: '6px 8px' }}>Why</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((row) => (
                <tr key={row.accountId} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                    {row.accountId.slice(0, 8)}
                    <div style={{ color: '#94a3b8', fontSize: 11 }}>{row.tenantId.slice(0, 8)}</div>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {row.venue}
                    <div style={{ color: '#94a3b8', fontSize: 11 }}>{row.environment}</div>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '1px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.04em',
                        backgroundColor: STATE_STYLE[row.state].background,
                        border: `1px ${row.state === 'UNKNOWN' ? 'dashed' : 'solid'} ${STATE_STYLE[row.state].border}`,
                        color: STATE_STYLE[row.state].color,
                      }}
                    >
                      {row.state}
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {formatAge(row.lastEventAgeMs)}
                    {row.lastEventAt && (
                      <div style={{ color: '#94a3b8', fontSize: 11 }}>{new Date(row.lastEventAt).toLocaleTimeString()}</div>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px' }}>{row.reconnectCount}</td>
                  <td style={{ padding: '6px 8px' }}>
                    {row.listenKeyAgeMs === null ? '—' : formatAge(row.listenKeyAgeMs)}
                    {row.listenKeyExpiresInMs !== null && (
                      <div style={{ color: row.listenKeyExpiresInMs < 300_000 ? '#b45309' : '#94a3b8', fontSize: 11 }}>
                        expires in {formatAge(row.listenKeyExpiresInMs)}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px', color: '#475569', fontSize: 12 }}>
                    {REASON_TEXT[row.reason] ?? row.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
