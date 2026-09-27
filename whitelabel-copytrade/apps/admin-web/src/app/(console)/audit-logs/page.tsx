import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, type Column } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, titleCase } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { theme, toneForStatus } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Audit log' };

interface AuditRow {
  id: string;
  actorType: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  outcome: string;
  resourceType: string | null;
  resourceId: string | null;
  description: string | null;
  ipHash: string | null;
  requestId: string | null;
  createdAt: string;
}

interface Paginated<T> {
  items: T[];
  pagination: { page: number; limit: number; totalItems: number; totalPages: number };
}

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: { page?: string; action?: string; outcome?: string };
}): Promise<JSX.Element> {
  const page = Number.parseInt(searchParams.page ?? '1', 10);

  let data: Paginated<AuditRow> | null = null;
  let error: string | null = null;

  try {
    data = await serverFetch<Paginated<AuditRow>>('/audit-logs', {
      searchParams: {
        page: Number.isFinite(page) && page > 0 ? page : 1,
        limit: 50,
        action: searchParams.action,
        outcome: searchParams.outcome,
      },
    });
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'The audit log could not be loaded.';
  }

  const columns: Array<Column<AuditRow>> = [
    { key: 'when', header: 'When', render: (row) => formatDateTime(row.createdAt) },
    {
      key: 'actor',
      header: 'Actor',
      render: (row) => (
        <div>
          <div style={{ fontSize: 13 }}>{row.actorEmail ?? titleCase(row.actorType)}</div>
          {row.actorId && (
            <code style={{ fontSize: 11, color: theme.color.textMuted }}>{row.actorId.slice(0, 8)}</code>
          )}
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (row) => <code style={{ fontSize: 12 }}>{row.action}</code>,
    },
    {
      key: 'outcome',
      header: 'Outcome',
      render: (row) => <Badge tone={toneForStatus(row.outcome)}>{titleCase(row.outcome)}</Badge>,
    },
    {
      key: 'resource',
      header: 'Resource',
      render: (row) =>
        row.resourceType ? (
          <div style={{ fontSize: 13 }}>
            {row.resourceType}
            {row.resourceId && (
              <div style={{ fontSize: 11, color: theme.color.textMuted }}>
                <code>{row.resourceId.slice(0, 8)}</code>
              </div>
            )}
          </div>
        ) : (
          '—'
        ),
    },
    {
      key: 'detail',
      header: 'Detail',
      render: (row) => (
        <div style={{ fontSize: 13, maxWidth: 320 }}>
          {row.description ?? '—'}
          {row.requestId && (
            <div style={{ fontSize: 11, color: theme.color.textMuted, marginTop: 4 }}>
              request <code>{row.requestId.slice(0, 8)}</code>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every privileged action, append-only and scoped to your organisation. IP addresses are stored as salted hashes, never in the clear, and no secret value is ever recorded."
      />

      {error ? (
        <ErrorNotice title="Unable to load the audit log" message={error} />
      ) : (
        <Card>
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(row) => row.id}
            emptyTitle="No audit entries yet"
            emptyDescription="Entries appear as soon as privileged actions are performed."
          />
          {data && (
            <p style={{ fontSize: 12, color: theme.color.textMuted, marginBottom: 0 }}>
              Showing page {data.pagination.page} of {data.pagination.totalPages || 1} ·{' '}
              {data.pagination.totalItems} total
            </p>
          )}
        </Card>
      )}
    </>
  );
}
