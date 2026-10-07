// # NEW — Displays balance/settlement discrepancies and resolution controls
'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, DataTable } from '@/components/ui';
import { apiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, formatRelative } from '@/lib/format';
import { theme } from '@/lib/theme';

export interface CustodyReconciliationFindingRow {
  id: string;
  type: string;
  reconciliationType?: string;
  discrepancyType?: string;
  assetId: string | null;
  networkId: string | null;
  walletId?: string | null;
  description: string | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  resolved: boolean;
  resolutionNote: string | null;
  correctiveAction: string | null;
  createdAt: string;
}

export interface FundingReconciliationTableProps {
  findings: CustodyReconciliationFindingRow[];
}

const severityTone: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  CRITICAL: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'info',
};

export function FundingReconciliationTable({
  findings,
}: FundingReconciliationTableProps): JSX.Element {
  const router = useRouter();
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState<string>('');
  const [correctiveAction, setCorrectiveAction] = useState<string>('MANUAL_VERIFICATION');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleRunReconciliation = () => {
    setErrorMessage(null);
    setStatusMessage(null);
    startTransition(async () => {
      try {
        await apiClient.post('/custody/reconciliation/run', {});
        setStatusMessage('Funding & custody reconciliation pass triggered.');
        router.refresh();
      } catch (err) {
        setErrorMessage(
          err instanceof ApiError ? err.message : (err as Error).message || 'Reconciliation run failed.',
        );
      }
    });
  };

  const handleResolveFinding = (findingId: string) => {
    if (resolutionNote.trim().length < 5) return;
    setErrorMessage(null);
    setStatusMessage(null);
    startTransition(async () => {
      try {
        await apiClient.post('/custody/reconciliation/resolve', {
          findingId,
          resolutionNote: resolutionNote.trim(),
          correctiveAction,
        });
        setResolvingId(null);
        setResolutionNote('');
        setStatusMessage(`Finding ${findingId.slice(0, 8)} resolved.`);
        router.refresh();
      } catch (err) {
        setErrorMessage(
          err instanceof ApiError ? err.message : (err as Error).message || 'Failed to resolve finding.',
        );
      }
    });
  };

  return (
    <div data-testid="funding-reconciliation-console" style={{ display: 'grid', gap: theme.space(4) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: theme.color.textMuted }}>
          Compares internal ledger deposit/withdrawal requests against authoritative custody and payment settlement records.
        </div>
        <button
          type="button"
          data-testid="run-custody-reconciliation-btn"
          disabled={pending}
          onClick={handleRunReconciliation}
          style={{
            fontSize: 12,
            padding: '6px 14px',
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.color.border}`,
            cursor: 'pointer',
          }}
        >
          {pending ? 'Running…' : 'Run Custody & Funding Reconciliation'}
        </button>
      </div>

      {errorMessage && (
        <p role="alert" style={{ color: 'var(--wlct-color-danger)', fontSize: 13, margin: 0 }}>
          {errorMessage}
        </p>
      )}
      {statusMessage && (
        <p role="status" style={{ fontSize: 13, margin: 0 }}>
          {statusMessage}
        </p>
      )}

      <DataTable
        rows={findings}
        rowKey={(row) => row.id}
        emptyTitle="No funding or custody discrepancies"
        emptyDescription="Internal ledger balances and settlement records match custody and payment providers."
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
            header: 'Discrepancy Type',
            render: (row) => (
              <code style={{ fontSize: 12 }}>
                {row.type || row.discrepancyType || row.reconciliationType || 'UNKNOWN'}
              </code>
            ),
          },
          {
            key: 'asset',
            header: 'Asset / Network',
            render: (row) => (
              <span style={{ fontSize: 12 }}>
                {row.assetId ?? '—'} {row.networkId ? `(${row.networkId})` : ''}
              </span>
            ),
          },
          {
            key: 'description',
            header: 'Finding Details',
            render: (row) => <span style={{ fontSize: 12 }}>{row.description ?? '—'}</span>,
          },
          {
            key: 'createdAt',
            header: 'Detected',
            render: (row) => (
              <span title={formatDateTime(row.createdAt)}>{formatRelative(row.createdAt)}</span>
            ),
          },
          {
            key: 'actions',
            header: 'Resolution',
            align: 'right',
            render: (row) => {
              if (row.resolved) {
                return (
                  <Badge tone="neutral">
                    Resolved ({row.correctiveAction ?? 'REVIEWED'})
                  </Badge>
                );
              }
              if (resolvingId === row.id) {
                return (
                  <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <select
                      aria-label="Corrective action"
                      value={correctiveAction}
                      onChange={(e) => setCorrectiveAction(e.target.value)}
                      style={{ fontSize: 12, padding: '4px 6px' }}
                    >
                      <option value="MANUAL_VERIFICATION">MANUAL_VERIFICATION</option>
                      <option value="PROVIDER_RESYNC">PROVIDER_RESYNC</option>
                      <option value="ESCALATED_TO_TREASURY">ESCALATED_TO_TREASURY</option>
                    </select>
                    <input
                      aria-label="Resolution note"
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      placeholder="Mandatory note (min 5 chars)"
                      style={{ fontSize: 12, padding: '4px 6px' }}
                    />
                    <button
                      type="button"
                      disabled={pending || resolutionNote.trim().length < 5}
                      onClick={() => handleResolveFinding(row.id)}
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
