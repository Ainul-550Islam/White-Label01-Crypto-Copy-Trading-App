import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, type Column } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, titleCase } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { theme, toneForStatus } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Settings' };

interface TenantSetting {
  key: string;
  value: unknown;
  isSecret: boolean;
  updatedAt: string;
}

interface TenantDetail {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  status: string;
  defaultLocale: string;
  supportedLocales: string[];
  defaultCurrency: string;
  supportedCurrencies: string[];
  timezone: string;
  contactEmail: string | null;
  contactPhone: string | null;
  countryCode: string | null;
  platformFeeBps: number;
  performanceFeeBps: number;
  domains?: Array<{ id: string; domain: string; isPrimary: boolean; verifiedAt: string | null }>;
}

interface TenantFeatureFlag {
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  isGlobalDefault: boolean;
  rolloutPercentage: number | null;
}

function renderSettingValue(setting: TenantSetting): JSX.Element {
  // Secret settings never leave the API in the clear; the API returns a marker
  // object instead. The console renders that marker rather than a value.
  if (setting.isSecret) {
    return <Badge tone="warning">Configured (hidden)</Badge>;
  }

  if (setting.value === null || setting.value === undefined) {
    return <span>—</span>;
  }

  if (typeof setting.value === 'object') {
    return (
      <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{JSON.stringify(setting.value)}</code>
    );
  }

  return <code style={{ fontSize: 12 }}>{String(setting.value)}</code>;
}

export default async function SettingsPage(): Promise<JSX.Element> {
  let tenant: TenantDetail | null = null;
  let settings: TenantSetting[] = [];
  let flags: TenantFeatureFlag[] = [];
  let error: string | null = null;

  try {
    tenant = await serverFetch<TenantDetail>('/tenants/current');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Settings could not be loaded.';
  }

  try {
    settings = await serverFetch<TenantSetting[]>('/tenants/current/settings');
  } catch {
    settings = [];
  }

  try {
    flags = await serverFetch<TenantFeatureFlag[]>('/feature-flags');
  } catch {
    flags = [];
  }

  const settingColumns: Array<Column<TenantSetting>> = [
    { key: 'key', header: 'Key', render: (row) => <code style={{ fontSize: 12 }}>{row.key}</code> },
    { key: 'value', header: 'Value', render: renderSettingValue },
    {
      key: 'secret',
      header: 'Sensitive',
      render: (row) => (row.isSecret ? <Badge tone="warning">Encrypted</Badge> : <Badge>Plain</Badge>),
    },
    { key: 'updated', header: 'Updated', render: (row) => formatDateTime(row.updatedAt) },
  ];

  const flagColumns: Array<Column<TenantFeatureFlag>> = [
    {
      key: 'flag',
      header: 'Feature',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.name}</div>
          <code style={{ fontSize: 12, color: theme.color.textMuted }}>{row.key}</code>
          {row.description && (
            <div style={{ fontSize: 12, color: theme.color.textMuted, marginTop: 4, maxWidth: 420 }}>
              {row.description}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'state',
      header: 'State',
      render: (row) =>
        row.enabled ? <Badge tone="success">Enabled</Badge> : <Badge>Disabled</Badge>,
    },
    {
      key: 'default',
      header: 'Global default',
      render: (row) => (row.isGlobalDefault ? 'On' : 'Off'),
    },
    {
      key: 'rollout',
      header: 'Rollout',
      align: 'right',
      render: (row) => (row.rolloutPercentage === null ? '—' : `${row.rolloutPercentage}%`),
    },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Organisation configuration. Values marked sensitive are encrypted at rest with a per-record data key and are never returned in plaintext by the API."
      />

      {error && <ErrorNotice title="Unable to load the organisation" message={error} />}

      <div style={{ display: 'grid', gap: theme.space(5), marginTop: error ? theme.space(5) : 0 }}>
        {tenant && (
          <Card title="Organisation">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: theme.space(4), fontSize: 14 }}>
              <div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>NAME</div>
                <div style={{ marginTop: 4 }}>{tenant.name}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>SLUG</div>
                <div style={{ marginTop: 4 }}>
                  <code>{tenant.slug}</code>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>STATUS</div>
                <div style={{ marginTop: 6 }}>
                  <Badge tone={toneForStatus(tenant.status)}>{titleCase(tenant.status)}</Badge>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>LEGAL NAME</div>
                <div style={{ marginTop: 4 }}>{tenant.legalName ?? '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>TIMEZONE</div>
                <div style={{ marginTop: 4 }}>{tenant.timezone}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>LOCALES</div>
                <div style={{ marginTop: 4 }}>
                  {tenant.defaultLocale} ({tenant.supportedLocales.join(', ')})
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>CURRENCIES</div>
                <div style={{ marginTop: 4 }}>
                  {tenant.defaultCurrency} ({tenant.supportedCurrencies.join(', ')})
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>CONTACT</div>
                <div style={{ marginTop: 4 }}>{tenant.contactEmail ?? '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>FEES</div>
                <div style={{ marginTop: 4 }}>
                  Platform {(tenant.platformFeeBps / 100).toFixed(2)}% · Performance{' '}
                  {(tenant.performanceFeeBps / 100).toFixed(2)}%
                </div>
              </div>
            </div>
          </Card>
        )}

        {tenant?.domains && tenant.domains.length > 0 && (
          <Card title="Domains" description="Custom domains resolve to this organisation.">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
              {tenant.domains.map((domain) => (
                <li key={domain.id} style={{ marginBottom: 4 }}>
                  <code>{domain.domain}</code>
                  {domain.isPrimary && <span style={{ marginLeft: 8 }}><Badge tone="info">Primary</Badge></span>}
                  <span style={{ marginLeft: 8 }}>
                    {domain.verifiedAt ? (
                      <Badge tone="success">Verified</Badge>
                    ) : (
                      <Badge tone="warning">Unverified</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Configuration values">
          <DataTable
            columns={settingColumns}
            rows={settings}
            rowKey={(row) => row.key}
            emptyTitle="No settings stored"
            emptyDescription="Defaults are applied when an organisation is created."
          />
        </Card>

        <Card
          title="Feature flags"
          description="Resolved per organisation. A tenant override always wins over the global default."
        >
          <DataTable columns={flagColumns} rows={flags} rowKey={(row) => row.key} emptyTitle="No feature flags defined" />
        </Card>
      </div>
    </>
  );
}
