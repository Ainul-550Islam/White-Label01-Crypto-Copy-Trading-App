// # Responsibility: read-only operator audit of withdrawal destinations and the policy decision taken on each, per tenant.
//
// WHY IT IS READ-ONLY
// -------------------
// An operator who can add a destination for a customer defeats the entire control:
// the cooldown exists because a stolen session must not be able to redirect funds,
// and an operator acting on a support call is exactly the social-engineering path
// that replaces that session. So this screen can see everything and change nothing.
// Revocation is available to the account holder only.
//
// What it is for:
//
//   * answering "where has this customer's money been allowed to go, and since when"
//     without querying the database by hand;
//   * showing the DECISIONS, not just the current list. The interesting artefact
//     after an incident is the sequence of ALLOW/DENY answers, with reasons, because
//     that is what proves the policy ran;
//   * making a PENDING destination obvious, so a support call about "my withdrawal is
//     blocked" has an answer on screen before anyone touches anything.
'use client';
import type { JSX } from 'react';

import { useMemo, useState } from 'react';

import type { DestinationAuditRow } from '@/api/execution-admin-api';

const STATUS_STYLE: Record<string, { border: string; background: string; color: string }> = {
  ACTIVE: { border: '#6ee7b7', background: '#ecfdf5', color: '#065f46' },
  PENDING: { border: '#fcd34d', background: '#fffbeb', color: '#92400e' },
  REVOKED: { border: '#cbd5e1', background: '#f8fafc', color: '#475569' },
};

/** Style for a status this build does not recognise: neutral, never "active". */
const FALLBACK_STATUS_STYLE = { border: '#cbd5e1', background: '#f8fafc', color: '#475569' };

const DECISION_STYLE: Record<string, { background: string; color: string }> = {
  ALLOW: { background: '#ecfdf5', color: '#065f46' },
  DENY: { background: '#fef2f2', color: '#991b1b' },
};

const DECISION_TEXT: Record<string, string> = {
  DESTINATION_NOT_ACTIVE: 'Refused: the destination had not finished its cooldown.',
  DESTINATION_REVOKED: 'Refused: the destination was revoked.',
  DESTINATION_UNKNOWN: 'Refused: the destination is not on this account.',
  NETWORK_MISMATCH: 'Refused: the destination is on a different network.',
  DAILY_LIMIT_EXCEEDED: 'Refused: the daily withdrawal limit was reached.',
  ALLOWED: 'Allowed.',
};

/**
 * The activation moment, rendered as the instant the cooldown ends rather than as a
 * live countdown.
 *
 * A countdown would need `Date.now()` during render, which is an impure read: the
 * same props would produce different markup on every re-render, React would be within
 * its rights to render twice and disagree, and `react-hooks/purity` rejects it. It is
 * also the wrong thing for this screen - an operator reading an audit table wants the
 * timestamp that will appear in the audit trail, not a number that has already
 * changed by the time they quote it.
 */
function formatActivatesAt(status: string, activatesAt: string): string {
  const parsed = Date.parse(activatesAt);
  if (!Number.isFinite(parsed)) return status === 'PENDING' ? 'not yet active' : 'unknown';
  const rendered = new Date(parsed).toLocaleString();
  return status === 'PENDING' ? `in cooldown until ${rendered}` : rendered;
}

export function WithdrawalDestinationAudit({
  rows,
  tenantId,
}: {
  rows: DestinationAuditRow[];
  tenantId?: string;
}): JSX.Element {
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'ACTIVE' | 'REVOKED'>('ALL');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'ALL' && row.status !== statusFilter) return false;
      if (needle.length === 0) return true;
      return (
        row.address.toLowerCase().includes(needle) ||
        row.label.toLowerCase().includes(needle) ||
        row.network.toLowerCase().includes(needle) ||
        row.userId.toLowerCase().includes(needle)
      );
    });
  }, [rows, filter, statusFilter]);

  const pending = rows.filter((row) => row.status === 'PENDING').length;
  const denials = rows.reduce(
    (total, row) => total + row.decisions.filter((decision) => decision.decision === 'DENY').length,
    0,
  );

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Withdrawal destinations</h2>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {rows.length} destination{rows.length === 1 ? '' : 's'} · {pending} in cooldown · {denials} refusals recorded
          {tenantId ? ` · tenant ${tenantId.slice(0, 8)}` : ''}
        </span>
      </header>

      <p style={{ margin: 0, fontSize: 12, color: '#475569' }}>
        Read-only. Changing a customer&apos;s allowlist is only possible from their own session, after a fresh identity
        check; an operator acting on a support call must never be able to redirect a withdrawal.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Address, label, network or user id"
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12, minWidth: 260 }}
        />
        {(['ALL', 'PENDING', 'ACTIVE', 'REVOKED'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setStatusFilter(option)}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: statusFilter === option ? '#0f172a' : '#ffffff',
              color: statusFilter === option ? '#ffffff' : '#0f172a',
              cursor: 'pointer',
            }}
          >
            {option}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p style={{ margin: 0, padding: 12, borderRadius: 6, border: '1px dashed #cbd5e1', fontSize: 13, color: '#475569' }}>
          No destination matches this view.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#475569' }}>
                <th style={{ padding: '6px 8px' }}>Customer</th>
                <th style={{ padding: '6px 8px' }}>Network</th>
                <th style={{ padding: '6px 8px' }}>Address</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
                <th style={{ padding: '6px 8px' }}>Activates</th>
                <th style={{ padding: '6px 8px' }}>Decisions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const style = STATUS_STYLE[row.status] ?? FALLBACK_STATUS_STYLE;
                const isOpen = expanded === row.id;
                return (
                  <tr key={row.id} style={{ borderTop: '1px solid #e2e8f0', verticalAlign: 'top' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                      {row.userId.slice(0, 8)}
                      <div style={{ color: '#94a3b8' }}>{row.tenantId.slice(0, 8)}</div>
                    </td>
                    <td style={{ padding: '6px 8px' }}>{row.network}</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 11, maxWidth: 320, wordBreak: 'break-all' }}>
                      {row.address}
                      <div style={{ color: '#94a3b8', fontFamily: 'inherit' }}>{row.label}</div>
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <span
                        style={{
                          padding: '1px 8px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          border: `1px solid ${style.border}`,
                          background: style.background,
                          color: style.color,
                        }}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td style={{ padding: '6px 8px', fontSize: 12 }}>
                      {formatActivatesAt(row.status, row.activatesAt)}
                      {row.revokedAt && (
                        <div style={{ color: '#94a3b8', fontSize: 11 }}>revoked {new Date(row.revokedAt).toLocaleDateString()}</div>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : row.id)}
                        style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer' }}
                      >
                        {row.decisions.length} recorded {isOpen ? '· hide' : '· show'}
                      </button>
                      {isOpen && (
                        <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
                          {row.decisions.length === 0 && (
                            <li style={{ fontSize: 11, color: '#64748b' }}>No withdrawal has been attempted to this address.</li>
                          )}
                          {row.decisions.map((decision, index) => {
                            const tone = DECISION_STYLE[decision.decision] ?? { background: '#f8fafc', color: '#334155' };
                            return (
                              <li
                                key={`${decision.at}-${index}`}
                                style={{ fontSize: 11, background: tone.background, color: tone.color, padding: '4px 8px', borderRadius: 4 }}
                              >
                                <strong>{decision.decision}</strong> · {new Date(decision.at).toLocaleString()} ·{' '}
                                {DECISION_TEXT[decision.reason] ?? decision.reason}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
