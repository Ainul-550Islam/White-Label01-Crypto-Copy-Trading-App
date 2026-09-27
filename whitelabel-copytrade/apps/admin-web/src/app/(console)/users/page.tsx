import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, type Column } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, titleCase } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { toneForStatus } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Users' };

interface UserRow {
  id: string;
  email: string;
  status: string;
  kycStatus: string;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  profile: { firstName: string | null; lastName: string | null; displayName: string | null };
  roles: Array<{ roleId: string; key: string; name: string }>;
}

interface Paginated<T> {
  items: T[];
  pagination: { page: number; limit: number; totalItems: number; totalPages: number };
}

function displayName(row: UserRow): string {
  const composed = [row.profile.firstName, row.profile.lastName].filter(Boolean).join(' ');
  return row.profile.displayName ?? (composed.length > 0 ? composed : '—');
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: { page?: string; search?: string; status?: string };
}): Promise<JSX.Element> {
  const page = Number.parseInt(searchParams.page ?? '1', 10);

  let data: Paginated<UserRow> | null = null;
  let error: string | null = null;

  try {
    data = await serverFetch<Paginated<UserRow>>('/users', {
      searchParams: {
        page: Number.isFinite(page) && page > 0 ? page : 1,
        limit: 25,
        search: searchParams.search,
        status: searchParams.status,
      },
    });
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'The user list could not be loaded.';
  }

  const columns: Array<Column<UserRow>> = [
    {
      key: 'user',
      header: 'User',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{displayName(row)}</div>
          <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>{row.email}</div>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (row) =>
        row.roles.length === 0 ? (
          '—'
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {row.roles.map((role) => (
              <Badge key={role.roleId}>{role.name}</Badge>
            ))}
          </div>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>,
    },
    {
      key: 'kyc',
      header: 'KYC',
      render: (row) => <Badge tone={toneForStatus(row.kycStatus)}>{titleCase(row.kycStatus)}</Badge>,
    },
    {
      key: '2fa',
      header: '2FA',
      render: (row) =>
        row.twoFactorEnabled ? <Badge tone="success">Enabled</Badge> : <Badge tone="warning">Off</Badge>,
    },
    { key: 'lastLogin', header: 'Last sign-in', render: (row) => formatDateTime(row.lastLoginAt) },
    { key: 'created', header: 'Created', render: (row) => formatDateTime(row.createdAt) },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description="Accounts inside the current organisation. The API scopes this list to your organisation automatically; a tenant id from the client is never trusted."
      />

      {error ? (
        <ErrorNotice title="Unable to list users" message={error} />
      ) : (
        <Card>
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(row) => row.id}
            emptyTitle="No users match this view"
          />
          {data && (
            <p style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)', marginBottom: 0 }}>
              Showing page {data.pagination.page} of {data.pagination.totalPages || 1} ·{' '}
              {data.pagination.totalItems} total
            </p>
          )}
        </Card>
      )}
    </>
  );
}
