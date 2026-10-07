// # NEW — Displays execution incidents, venue outages, and manual resolution actions
'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, DataTable } from '@/components/ui';
import { apiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, formatRelative } from '@/lib/format';
import { theme } from '@/lib/theme';

export interface ExecutionIncidentRow {
  id: string;
  accountId: string | null;
  orderId: string | null;
  clientOrderId: string | null;
  incidentType: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  venue: string | null;
  symbol: string | null;
  errorCode: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  occurredAtMicros: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

export interface ExecutionKillSwitchItem {
  id: string;
  scope: 'GLOBAL' | 'EXCHANGE' | 'STRATEGY' | 'SYMBOL';
  target: string | null;
  isEngaged: boolean;
  reason: string | null;
  engagedAt: string | null;
  releasedAt: string | null;
}

export interface ExecutionIncidentTableProps {
  incidents: ExecutionIncidentRow[];
  killSwitches?: ExecutionKillSwitchItem[];
}

const severityTone: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  CRITICAL: 'danger',
  WARNING: 'warning',
  INFO: 'info',
};

export function ExecutionIncidentTable({
  incidents,
  killSwitches = [],
}: ExecutionIncidentTableProps): JSX.Element {
  const router = useRouter();
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState<string>('');
  const [ksScope, setKsScope] = useState<'GLOBAL' | 'EXCHANGE' | 'STRATEGY' | 'SYMBOL'>('EXCHANGE');
  const [ksTarget, setKsTarget] = useState<string>('');
  const [ksEngaged, setKsEngaged] = useState<boolean>(true);
  const [ksReason, setKsReason] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleResolveIncident = (incidentId: string) => {
    if (resolutionNote.trim().length < 5) return;
    setErrorMessage(null);
    setStatusMessage(null);
    startTransition(async () => {
      try {
        await apiClient.post(`/execution/incidents/${incidentId}/resolve`, {
          note: resolutionNote.trim(),
        });
        setResolvingId(null);
        setResolutionNote('');
        setStatusMessage(`Incident ${incidentId.slice(0, 8)} resolved and audited.`);
        router.refresh();
      } catch (err) {
        setErrorMessage(
          err instanceof ApiError ? err.message : (err as Error).message || 'Failed to resolve incident.',
        );
      }
    });
  };

  const handleSetKillSwitch = (e: React.FormEvent) => {
    e.preventDefault();
    if (ksReason.trim().length < 10) return;
    if (ksScope !== 'GLOBAL' && !ksTarget.trim()) return;
    setErrorMessage(null);
    setStatusMessage(null);
    startTransition(async () => {
      try {
        await apiClient.post('/execution/kill-switches', {
          scope: ksScope,
          ...(ksScope !== 'GLOBAL' ? { target: ksTarget.trim() } : {}),
          engaged: ksEngaged,
          reason: ksReason.trim(),
        });
        setKsReason('');
        setKsTarget('');
        setStatusMessage(
          `Kill switch (${ksScope}${ksTarget ? `:${ksTarget}` : ''}) ${ksEngaged ? 'engaged' : 'released'}.`,
        );
        router.refresh();
      } catch (err) {
        setErrorMessage(
          err instanceof ApiError ? err.message : (err as Error).message || 'Kill switch update failed.',
        );
      }
    });
  };

  return (
    <div data-testid="execution-incident-console" style={{ display: 'grid', gap: theme.space(5) }}>
      {errorMessage && (
        <p role="alert" style={{ color: 'var(--wlct-color-danger)', fontSize: 13, margin: 0 }}>
          {errorMessage}
        </p>
      )}
      {statusMessage && (
        <p role="status" style={{ color: 'var(--wlct-color-success, inherit)', fontSize: 13, margin: 0 }}>
          {statusMessage}
        </p>
      )}

      {/* Execution Kill Switch Operator Panel */}
      <form
        onSubmit={handleSetKillSwitch}
        data-testid="execution-kill-switch-form"
        style={{
          border: `1px solid ${theme.color.border}`,
          borderRadius: theme.radius.md,
          padding: theme.space(4),
          display: 'grid',
          gap: theme.space(3),
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14 }}>
          Execution Safety Kill-Switch Control (GLOBAL / EXCHANGE / STRATEGY / SYMBOL)
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: theme.space(3),
          }}
        >
          <label style={{ fontSize: 12, color: theme.color.textMuted }}>
            Scope
            <select
              aria-label="Kill switch scope"
              value={ksScope}
              onChange={(e) =>
                setKsScope(e.target.value as 'GLOBAL' | 'EXCHANGE' | 'STRATEGY' | 'SYMBOL')
              }
              style={{ width: '100%', padding: '6px 8px', marginTop: 4 }}
            >
              <option value="GLOBAL">GLOBAL</option>
              <option value="EXCHANGE">EXCHANGE</option>
              <option value="STRATEGY">STRATEGY</option>
              <option value="SYMBOL">SYMBOL</option>
            </select>
          </label>
          <label style={{ fontSize: 12, color: theme.color.textMuted }}>
            Target (Venue / Strategy / Symbol)
            <input
              aria-label="Kill switch target"
              disabled={ksScope === 'GLOBAL'}
              value={ksTarget}
              onChange={(e) => setKsTarget(e.target.value)}
              placeholder={ksScope === 'GLOBAL' ? 'Not required for GLOBAL' : 'e.g. BINANCE or BTC-USDT'}
              style={{ width: '100%', padding: '6px 8px', marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: 12, color: theme.color.textMuted }}>
            Action
            <select
              aria-label="Kill switch action"
              value={ksEngaged ? 'ENGAGE' : 'RELEASE'}
              onChange={(e) => setKsEngaged(e.target.value === 'ENGAGE')}
              style={{ width: '100%', padding: '6px 8px', marginTop: 4 }}
            >
              <option value="ENGAGE">ENGAGE (Halt Orders)</option>
              <option value="RELEASE">RELEASE (Resume Orders)</option>
            </select>
          </label>
          <label style={{ fontSize: 12, color: theme.color.textMuted }}>
            Mandatory Reason (min 10 chars)
            <input
              aria-label="Kill switch reason"
              value={ksReason}
              onChange={(e) => setKsReason(e.target.value)}
              placeholder="Explain why this switch is being changed..."
              style={{ width: '100%', padding: '6px 8px', marginTop: 4 }}
            />
          </label>
        </div>
        <div>
          <button
            type="submit"
            disabled={
              pending ||
              ksReason.trim().length < 10 ||
              (ksScope !== 'GLOBAL' && !ksTarget.trim())
            }
            style={{
              fontSize: 12,
              padding: '6px 14px',
              borderRadius: theme.radius.md,
              border: `1px solid ${theme.color.border}`,
              cursor: 'pointer',
            }}
          >
            {pending ? 'Applying…' : ksEngaged ? 'Engage Kill Switch' : 'Release Kill Switch'}
          </button>
        </div>

        {killSwitches.length > 0 && (
          <div style={{ fontSize: 12, color: theme.color.textMuted }}>
            Active / Recorded Switches:{' '}
            {killSwitches.map((sw) => (
              <span key={sw.id} style={{ marginRight: 12 }}>
                <strong>
                  {sw.scope}
                  {sw.target ? `:${sw.target}` : ''}
                </strong>{' '}
                ({sw.isEngaged ? 'ENGAGED' : 'RELEASED'})
              </span>
            ))}
          </div>
        )}
      </form>

      {/* Execution Incidents Table */}
      <DataTable
        rows={incidents}
        rowKey={(row) => row.id}
        emptyTitle="No execution incidents recorded"
        emptyDescription="Zero unresolved execution incidents or stuck orders in this tenant."
        columns={[
          {
            key: 'severity',
            header: 'Severity',
            render: (row) => (
              <Badge tone={severityTone[row.severity] ?? 'neutral'}>{row.severity}</Badge>
            ),
          },
          {
            key: 'type',
            header: 'Incident Type',
            render: (row) => <code style={{ fontSize: 12 }}>{row.incidentType}</code>,
          },
          {
            key: 'venue',
            header: 'Venue / Symbol',
            render: (row) => (
              <span style={{ fontSize: 12 }}>
                {row.venue ?? '—'} {row.symbol ? `· ${row.symbol}` : ''}
              </span>
            ),
          },
          {
            key: 'order',
            header: 'Order / Client ID',
            render: (row) => (
              <code style={{ fontSize: 12 }}>
                {row.clientOrderId ?? row.orderId?.slice(0, 8) ?? '—'}
              </code>
            ),
          },
          {
            key: 'summary',
            header: 'Summary',
            render: (row) => <span style={{ fontSize: 12 }}>{row.summary}</span>,
          },
          {
            key: 'when',
            header: 'Occurred',
            render: (row) => (
              <span title={formatDateTime(row.createdAt)}>{formatRelative(row.createdAt)}</span>
            ),
          },
          {
            key: 'status',
            header: 'Resolution',
            align: 'right',
            render: (row) => {
              if (row.resolvedAt) {
                return (
                  <Badge tone="neutral">
                    Resolved ({row.resolutionNote?.slice(0, 24) ?? 'noted'})
                  </Badge>
                );
              }
              if (resolvingId === row.id) {
                return (
                  <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <input
                      aria-label="Resolution note"
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      placeholder="Resolution note (min 5 chars)"
                      style={{ fontSize: 12, padding: '4px 6px' }}
                    />
                    <button
                      type="button"
                      disabled={pending || resolutionNote.trim().length < 5}
                      onClick={() => handleResolveIncident(row.id)}
                      style={{ fontSize: 12, padding: '4px 8px' }}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setResolvingId(null);
                        setResolutionNote('');
                      }}
                      style={{ fontSize: 12, padding: '4px 8px' }}
                    >
                      Cancel
                    </button>
                  </div>
                );
              }
              return (
                <button
                  type="button"
                  data-testid={`resolve-incident-${row.id}`}
                  onClick={() => setResolvingId(row.id)}
                  style={{
                    fontSize: 12,
                    padding: '4px 10px',
                    borderRadius: theme.radius.md,
                    border: `1px solid ${theme.color.border}`,
                    cursor: 'pointer',
                  }}
                >
                  Resolve…
                </button>
              );
            },
          },
        ]}
      />
    </div>
  );
}
