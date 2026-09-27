import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, type Column } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Roles & permissions' };

interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  scope: string;
  isSystem: boolean;
  isDefault: boolean;
  priority: number;
  permissions: string[];
  memberCount: number;
}

interface Paginated<T> {
  items: T[];
  pagination: { totalItems: number };
}

interface PermissionCatalogueEntry {
  key: string;
  description: string;
  resource: string;
}

export default async function RolesPage(): Promise<JSX.Element> {
  let roles: Paginated<RoleRow> | null = null;
  let catalogue: PermissionCatalogueEntry[] = [];
  let error: string | null = null;

  try {
    roles = await serverFetch<Paginated<RoleRow>>('/roles', {
      searchParams: { page: 1, limit: 50 },
    });
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Roles could not be loaded.';
  }

  try {
    catalogue = await serverFetch<PermissionCatalogueEntry[]>('/permissions');
  } catch {
    catalogue = [];
  }

  const columns: Array<Column<RoleRow>> = [
    {
      key: 'role',
      header: 'Role',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.name}</div>
          <div style={{ fontSize: 12, color: theme.color.textMuted }}>
            <code>{row.key}</code> · {row.scope}
          </div>
          {row.description && (
            <div style={{ fontSize: 12, color: theme.color.textMuted, marginTop: 4, maxWidth: 380 }}>
              {row.description}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'flags',
      header: 'Type',
      render: (row) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {row.isSystem && <Badge tone="info">System</Badge>}
          {row.isDefault && <Badge tone="success">Default</Badge>}
          {!row.isSystem && !row.isDefault && <Badge>Custom</Badge>}
        </div>
      ),
    },
    { key: 'members', header: 'Members', align: 'right', render: (row) => row.memberCount },
    { key: 'priority', header: 'Priority', align: 'right', render: (row) => row.priority },
    {
      key: 'permissions',
      header: 'Permissions',
      render: (row) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 420 }}>
          {row.permissions.slice(0, 8).map((permission) => (
            <code
              key={permission}
              style={{
                fontSize: 11,
                background: theme.color.surfaceRaised,
                padding: '2px 6px',
                borderRadius: 4,
              }}
            >
              {permission}
            </code>
          ))}
          {row.permissions.length > 8 && (
            <span style={{ fontSize: 11, color: theme.color.textMuted }}>
              +{row.permissions.length - 8} more
            </span>
          )}
        </div>
      ),
    },
  ];

  const groupedCatalogue = catalogue.reduce<Record<string, PermissionCatalogueEntry[]>>(
    (accumulator, entry) => {
      const bucket = accumulator[entry.resource] ?? [];
      bucket.push(entry);
      accumulator[entry.resource] = bucket;
      return accumulator;
    },
    {},
  );

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="System roles are immutable templates cloned into every organisation. Custom roles draw from the same permission catalogue, so adding a role never requires an authorisation rewrite."
      />

      {error ? (
        <ErrorNotice title="Unable to list roles" message={error} />
      ) : (
        <Card>
          <DataTable columns={columns} rows={roles?.items ?? []} rowKey={(row) => row.id} emptyTitle="No roles defined" />
        </Card>
      )}

      <div style={{ marginTop: theme.space(6) }}>
        <Card
          title="Permission catalogue"
          description="Every permission the platform understands, grouped by resource. Wildcards (resource:*) are supported."
        >
          {Object.keys(groupedCatalogue).length === 0 ? (
            <p style={{ color: theme.color.textMuted, fontSize: 14, margin: 0 }}>
              The permission catalogue is unavailable.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: theme.space(4) }}>
              {Object.entries(groupedCatalogue).map(([resource, entries]) => (
                <div key={resource}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{resource}</div>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: theme.color.textMuted }}>
                    {entries.map((entry) => (
                      <li key={entry.key}>
                        <code>{entry.key}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
