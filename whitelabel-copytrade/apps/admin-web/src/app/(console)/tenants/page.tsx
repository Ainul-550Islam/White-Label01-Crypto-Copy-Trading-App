import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, type Column } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, formatLimit, titleCase } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { toneForStatus } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Organisations' };

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  contactEmail: string | null;
  maxUsers: number | null;
  maxTraders: number | null;
  platformFeeBps: number;
  createdAt: string;
}

interface Paginated<T> {
  items: T[];
  pagination: { page: number; limit: number; totalItems: number; totalPages: number };
}

/**
 * Platform-only view of every organisation.
 *
 * Authorisation is enforced by the API: a tenant admin calling this endpoint
 * receives 403, and the page renders that as a plain message rather than a
 * crash.
 */
export default async function TenantsPage({
  searchParams,
}: {
  searchParams: { page?: string; search?: string };
}): Promise<JSX.Element> {
  const page = Number.parseInt(searchParams.page ?? '1', 10);

  let data: Paginated<TenantRow> | null = null;
  let error: string | null = null;

  try {
    data = await serverFetch<Paginated<TenantRow>>('/tenants', {
      searchParams: {
        page: Number.isFinite(page) && page > 0 ? page : 1,
        limit: 25,
        search: searchParams.search,
      },
    });
  } catch (caught) {
    error =
      caught instanceof ApiError
        ? caught.message
        : 'The organisation list could not be loaded.';
  }

  const columns: Array<Column<TenantRow>> = [
    {
      key: 'name',
      header: 'Organisation',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.name}</div>
          <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>{row.slug}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>,
    },
    {
      key: 'contact',
      header: 'Contact',
      render: (row) => row.contactEmail ?? '—',
    },
    { key: 'users', header: 'User cap', align: 'right', render: (row) => formatLimit(row.maxUsers) },
    {
      key: 'traders',
      header: 'Trader cap',
      align: 'right',
      render: (row) => formatLimit(row.maxTraders),
    },
    {
      key: 'fee',
      header: 'Platform fee',
      align: 'right',
      render: (row) => `${(row.platformFeeBps / 100).toFixed(2)}%`,
    },
    { key: 'created', header: 'Created', render: (row) => formatDateTime(row.createdAt) },
  ];

  return (
    <>
      <PageHeader
        title="Organisations"
        description="Every white-label organisation on the platform. Creating and suspending organisations is restricted to platform operators."
      />

      {error ? (
        <ErrorNotice title="Unable to list organisations" message={error} />
      ) : (
        <Card>
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(row) => row.id}
            emptyTitle="No organisations yet"
            emptyDescription="Provision the first organisation with POST /v1/tenants."
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
