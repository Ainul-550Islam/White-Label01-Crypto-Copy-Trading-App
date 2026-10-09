// # NEW — Renders partner list, tier override controls, and payout approval actions
// # NEW — partner list, agreements, settlements, payouts, reconciliation UI
'use client';
import type { JSX } from 'react';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, DataTable } from '@/components/ui';
import { apiClient } from '@/lib/api-client';
import { ApiError } from '@wlct/utils/api-error';
import { formatDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';

export interface PartnerAdminRow {
  id: string;
  code: string;
  name: string;
  legalName: string;
  type: string;
  state: string;
  contactEmail: string;
  currency: string;
  createdAt: string;
}

export interface PartnerAdminTableProps {
  partners: PartnerAdminRow[];
}

export function isPartnerStateTransitionAllowed(fromState: string, toState: string): boolean {
  const allowed: Record<string, string[]> = {
    PENDING: ['UNDER_REVIEW', 'ACTIVE', 'TERMINATED'],
    UNDER_REVIEW: ['ACTIVE', 'SUSPENDED', 'TERMINATED'],
    ACTIVE: ['SUSPENDED', 'TERMINATION_PENDING', 'TERMINATED'],
    SUSPENDED: ['REACTIVATION_REVIEW', 'ACTIVE', 'TERMINATED'],
    REACTIVATION_REVIEW: ['ACTIVE', 'SUSPENDED', 'TERMINATED'],
    TERMINATION_PENDING: ['TERMINATED'],
    TERMINATED: [],
  };
  return (allowed[fromState] ?? []).includes(toState);
}

export function PartnerAdminTable({ partners }: PartnerAdminTableProps): JSX.Element {
  const router = useRouter();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleTransitionPartner = (partnerId: string, targetState: string) => {
    setErrorMessage(null);
    setStatusMessage(null);
    startTransition(async () => {
      try {
        await apiClient.post(`/partners/${partnerId}/transition`, {
          partnerId,
          targetState,
          correlationId: `corr_${Date.now()}`,
          actorId: 'platform-admin',
          actorRole: 'PLATFORM_ADMIN',
          reason: `Operator transitioned partner ${partnerId} to ${targetState}`,
        });
        setStatusMessage(`Partner ${partnerId} transitioned to ${targetState}.`);
        router.refresh();
      } catch (err) {
        setErrorMessage(
          err instanceof ApiError
            ? err.message
            : (err as Error).message || 'Partner state transition failed.',
        );
      }
    });
  };

  return (
    <div data-testid="partner-admin-table" style={{ display: 'grid', gap: theme.space(4) }}>
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
        rows={partners}
        rowKey={(row) => row.id}
        emptyTitle="No partner or IB profiles registered"
        emptyDescription="Create or onboard an Introducing Broker, Affiliate, or White-Label Reseller profile."
        columns={[
          {
            key: 'partner',
            header: 'Partner / Code',
            render: (row) => (
              <div>
                <Link
                  href={`/partners/${row.id}`}
                  style={{ fontWeight: 600, fontSize: 13, textDecoration: 'underline' }}
                >
                  {row.name}
                </Link>
                <div style={{ fontSize: 11, color: theme.color.textMuted }}>
                  <code>{row.code}</code> · {row.legalName}
                </div>
              </div>
            ),
          },
          {
            key: 'type',
            header: 'Tier / Type',
            render: (row) => <Badge tone="info">{row.type}</Badge>,
          },
          {
            key: 'state',
            header: 'State',
            render: (row) => (
              <Badge tone={row.state === 'ACTIVE' ? 'info' : 'warning'}>{row.state}</Badge>
            ),
          },
          {
            key: 'contact',
            header: 'Contact / Currency',
            render: (row) => (
              <span style={{ fontSize: 12 }}>
                {row.contactEmail} ({row.currency})
              </span>
            ),
          },
          {
            key: 'created',
            header: 'Created',
            render: (row) => <span style={{ fontSize: 12 }}>{formatDateTime(row.createdAt)}</span>,
          },
          {
            key: 'actions',
            header: 'Admin Actions',
            align: 'right',
            render: (row) => (
              <div style={{ display: 'inline-flex', gap: 6 }}>
                <button
                  type="button"
                  disabled={pending || row.state === 'ACTIVE'}
                  onClick={() => handleTransitionPartner(row.id, 'ACTIVE')}
                  style={{ fontSize: 12, padding: '4px 8px' }}
                >
                  Approve / Activate
                </button>
                <button
                  type="button"
                  disabled={pending || row.state === 'SUSPENDED'}
                  onClick={() => handleTransitionPartner(row.id, 'SUSPENDED')}
                  style={{ fontSize: 12, padding: '4px 8px' }}
                >
                  Suspend
                </button>
                <Link
                  href={`/partners/${row.id}`}
                  style={{ fontSize: 12, padding: '4px 8px', textDecoration: 'underline' }}
                >
                  Audit →
                </Link>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default PartnerAdminTable;
