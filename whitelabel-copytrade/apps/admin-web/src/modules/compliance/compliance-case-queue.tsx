// # NEW — Renders filterable compliance case queue by severity, status, and SLA
'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, DataTable } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';
import { theme } from '@/lib/theme';

export interface ComplianceCaseQueueItem {
  id: string;
  tenantId: string;
  userId: string;
  caseType: string;
  state: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  severity: string;
  safeSummary: string;
  assignedTo: string | null;
  jurisdiction: string | null;
  slaDueAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceCaseQueueProps {
  cases: ComplianceCaseQueueItem[];
  initialStateFilter?: string;
  initialSeverityFilter?: string;
}

const riskTone: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  CRITICAL: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'info',
};

const stateTone: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  OPEN: 'warning',
  IN_REVIEW: 'info',
  ESCALATED: 'danger',
  EDD_REQUIRED: 'danger',
  ON_HOLD: 'danger',
  RESOLVED: 'neutral',
  CLOSED: 'neutral',
};

export function ComplianceCaseQueue({
  cases,
  initialStateFilter = 'ALL',
  initialSeverityFilter = 'ALL',
}: ComplianceCaseQueueProps): JSX.Element {
  const [stateFilter, setStateFilter] = useState<string>(initialStateFilter);
  const [severityFilter, setSeverityFilter] = useState<string>(initialSeverityFilter);

  const filtered = useMemo(() => {
    return cases.filter((c) => {
      if (stateFilter !== 'ALL' && c.state !== stateFilter) return false;
      if (severityFilter !== 'ALL' && c.riskLevel !== severityFilter && c.severity !== severityFilter) {
        return false;
      }
      return true;
    });
  }, [cases, stateFilter, severityFilter]);

  return (
    <div data-testid="compliance-case-queue" style={{ display: 'grid', gap: theme.space(4) }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: theme.space(3),
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: theme.space(3), alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: theme.color.textMuted }}>
            Case Status:{' '}
            <select
              aria-label="Filter by status"
              data-testid="compliance-status-filter"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              style={{ fontSize: 12, padding: '4px 8px', marginLeft: 4 }}
            >
              <option value="ALL">All Statuses</option>
              <option value="OPEN">OPEN</option>
              <option value="IN_REVIEW">IN_REVIEW</option>
              <option value="ESCALATED">ESCALATED</option>
              <option value="EDD_REQUIRED">EDD_REQUIRED</option>
              <option value="ON_HOLD">ON_HOLD</option>
              <option value="RESOLVED">RESOLVED</option>
              <option value="CLOSED">CLOSED</option>
            </select>
          </label>

          <label style={{ fontSize: 12, color: theme.color.textMuted }}>
            Risk / Severity:{' '}
            <select
              aria-label="Filter by severity"
              data-testid="compliance-severity-filter"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              style={{ fontSize: 12, padding: '4px 8px', marginLeft: 4 }}
            >
              <option value="ALL">All Risk Levels</option>
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>
          </label>
        </div>

        <div style={{ fontSize: 12, color: theme.color.textMuted }}>
          Showing {filtered.length} of {cases.length} cases
        </div>
      </div>

      <DataTable
        rows={filtered}
        rowKey={(row) => row.id}
        emptyTitle="No compliance cases match filter"
        emptyDescription="Zero compliance cases in the selected status or risk bucket."
        columns={[
          {
            key: 'caseId',
            header: 'Case ID',
            render: (row) => (
              <Link
                href={`/compliance/${row.id}`}
                style={{ fontWeight: 600, fontSize: 12, textDecoration: 'underline' }}
              >
                {row.id.slice(0, 10)}
              </Link>
            ),
          },
          {
            key: 'state',
            header: 'Status',
            render: (row) => <Badge tone={stateTone[row.state] ?? 'neutral'}>{row.state}</Badge>,
          },
          {
            key: 'risk',
            header: 'Risk / Severity',
            render: (row) => (
              <Badge tone={riskTone[row.riskLevel] ?? 'neutral'}>
                {row.riskLevel} · {row.severity}
              </Badge>
            ),
          },
          {
            key: 'type',
            header: 'Case Type',
            render: (row) => <code style={{ fontSize: 12 }}>{row.caseType}</code>,
          },
          {
            key: 'user',
            header: 'Subject User',
            render: (row) => <code style={{ fontSize: 12 }}>{row.userId}</code>,
          },
          {
            key: 'summary',
            header: 'Safe Summary',
            render: (row) => <span style={{ fontSize: 12 }}>{row.safeSummary}</span>,
          },
          {
            key: 'assigned',
            header: 'Reviewer / SLA',
            render: (row) => (
              <span style={{ fontSize: 12 }}>
                {row.assignedTo ?? 'Unassigned'}
                {row.slaDueAt ? ` · Due ${formatRelative(row.slaDueAt)}` : ''}
              </span>
            ),
          },
          {
            key: 'created',
            header: 'Opened',
            align: 'right',
            render: (row) => (
              <span title={formatDateTime(row.createdAt)}>{formatRelative(row.createdAt)}</span>
            ),
          },
        ]}
      />
    </div>
  );
}
