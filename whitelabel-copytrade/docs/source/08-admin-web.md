# Admin console (Next.js)

Server-side session handling, the proxy route, and the console screens.

47 files. Part of the complete Part 1 source dump - see `docs/source/README.md`.

---

FILE: apps/admin-web/.env.example

```ini
# Admin console configuration.
# Values prefixed NEXT_PUBLIC_ are embedded in the browser bundle: never put a
# secret in one.

# Server-side base URL used by route handlers and server components.
API_BASE_URL=http://localhost:4000/api
# Tenant the console administers when no custom domain is in play.
ADMIN_TENANT_SLUG=platform
# Session cookie signing salt. Generate with: openssl rand -base64 32
SESSION_COOKIE_SECRET=

NEXT_PUBLIC_APP_NAME=Copy Trading Console
NEXT_PUBLIC_API_VERSION=v1
NEXT_PUBLIC_WS_URL=http://localhost:4000
NEXT_PUBLIC_WS_PATH=/socket.io
```

FILE: apps/admin-web/.eslintrc.json

```json
{
  "extends": ["next/core-web-vitals"],
  "rules": {
    "no-console": ["error", { "allow": ["warn", "error"] }]
  }
}
```

FILE: apps/admin-web/next-env.d.ts

```typescript
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/building-your-application/configuring/typescript for more information.
```

FILE: apps/admin-web/next.config.mjs

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Produces .next/standalone so the Docker runtime image ships only the
  // server bundle and its traced dependencies.
  output: 'standalone',
  // The admin console is a first-party app; transpile the workspace packages
  // rather than publishing build artefacts for them.
  transpilePackages: ['@wlct/shared-types', '@wlct/validation'],
  experimental: {
    typedRoutes: false,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
```

FILE: apps/admin-web/package.json

```json
{
  "name": "@wlct/admin-web",
  "version": "1.0.0",
  "private": true,
  "description": "Next.js administration console for platform and tenant operators",
  "scripts": {
    "dev": "next dev -p 3000 -H 0.0.0.0",
    "build": "next build",
    "start": "next start -p 3000 -H 0.0.0.0",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.59.0",
    "@wlct/shared-types": "1.0.0",
    "@wlct/validation": "1.0.0",
    "jose": "^5.9.3",
    "next": "14.2.15",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "server-only": "^0.0.1",
    "socket.io-client": "^4.8.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.10",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.0",
    "eslint": "^8.57.0",
    "eslint-config-next": "14.2.15",
    "typescript": "^5.5.4"
  }
}
```

FILE: apps/admin-web/public/robots.txt

```text
# The administration console must never be indexed.
User-agent: *
Disallow: /
```

FILE: apps/admin-web/src/app/(console)/audit-logs/page.tsx

```tsx
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
```

FILE: apps/admin-web/src/app/(console)/branding/page.tsx

```tsx
import type { Metadata } from 'next';

import { Card, ErrorNotice, PageHeader } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatDateTime } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Branding' };

interface Branding {
  appName: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  themeMode: 'light' | 'dark' | 'system';
  supportEmail: string | null;
  supportUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  socialLinks: Record<string, string>;
  updatedAt: string;
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function Swatch({ label, value }: { label: string; value: string }): JSX.Element {
  // Tenant-supplied colours are validated before they reach a style attribute.
  const safe = HEX_COLOR.test(value) ? value : 'transparent';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(3) }}>
      <span
        aria-hidden="true"
        style={{
          width: 34,
          height: 34,
          borderRadius: theme.radius.sm,
          background: safe,
          border: `1px solid ${theme.color.border}`,
          display: 'inline-block',
        }}
      />
      <span>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{label}</span>
        <code style={{ fontSize: 12, color: theme.color.textMuted }}>{value}</code>
      </span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }): JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 12, color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, marginTop: 4, wordBreak: 'break-all' }}>{value ?? '—'}</div>
    </div>
  );
}

export default async function BrandingPage(): Promise<JSX.Element> {
  let branding: Branding | null = null;
  let error: string | null = null;

  try {
    branding = await serverFetch<Branding>('/tenants/current/branding');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Branding could not be loaded.';
  }

  return (
    <>
      <PageHeader
        title="Branding"
        description="Drives the mobile app, the customer-facing web surfaces and transactional email. Colours are validated as hex values server-side before they are ever rendered or emailed."
      />

      {error || !branding ? (
        <ErrorNotice title="Unable to load branding" message={error ?? 'No branding configured.'} />
      ) : (
        <div style={{ display: 'grid', gap: theme.space(5) }}>
          <Card title="Identity" description={`Last updated ${formatDateTime(branding.updatedAt)}`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: theme.space(4) }}>
              <Field label="App name" value={branding.appName} />
              <Field label="Theme mode" value={branding.themeMode} />
              <Field label="Font family" value={branding.fontFamily} />
              <Field label="Logo" value={branding.logoUrl} />
              <Field label="Dark logo" value={branding.logoDarkUrl} />
              <Field label="Favicon" value={branding.faviconUrl} />
            </div>
          </Card>

          <Card title="Palette" description="Applied as CSS custom properties at render time.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: theme.space(4) }}>
              <Swatch label="Primary" value={branding.primaryColor} />
              <Swatch label="Secondary" value={branding.secondaryColor} />
              <Swatch label="Accent" value={branding.accentColor} />
              <Swatch label="Background" value={branding.backgroundColor} />
              <Swatch label="Text" value={branding.textColor} />
            </div>
          </Card>

          <Card title="Support & legal links">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: theme.space(4) }}>
              <Field label="Support email" value={branding.supportEmail} />
              <Field label="Support URL" value={branding.supportUrl} />
              <Field label="Terms" value={branding.termsUrl} />
              <Field label="Privacy" value={branding.privacyUrl} />
            </div>

            {Object.keys(branding.socialLinks).length > 0 && (
              <div style={{ marginTop: theme.space(4) }}>
                <div style={{ fontSize: 12, color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  Social
                </div>
                <ul style={{ margin: `${theme.space(2)} 0 0`, paddingLeft: 18, fontSize: 13 }}>
                  {Object.entries(branding.socialLinks).map(([network, url]) => (
                    <li key={network}>
                      {network}: <span style={{ wordBreak: 'break-all' }}>{url}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card title="Editing branding">
            <p style={{ margin: 0, fontSize: 14, color: theme.color.textMuted }}>
              Send a <code>PATCH /v1/tenants/current/branding</code> with the fields you want to
              change. The endpoint requires the <code>tenant:manage</code> permission and every
              change is written to the audit log. An in-console editor lands with the branding work
              in Part 3.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
```

FILE: apps/admin-web/src/app/(console)/dashboard/page.tsx

```tsx
import type { Metadata } from 'next';

import { Card, ErrorNotice, StatTile, Badge } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, formatLimit, titleCase } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { theme, toneForStatus } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Overview' };

interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  maxUsers: number | null;
  maxTraders: number | null;
  createdAt: string;
}

interface SubscriptionSummary {
  status: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  plan?: { name: string; code: string };
}

interface PaginatedUsers {
  items: unknown[];
  pagination: { totalItems: number };
}

interface DashboardData {
  tenant: TenantSummary | null;
  subscription: SubscriptionSummary | null;
  userCount: number | null;
  flags: Record<string, boolean> | null;
  failures: string[];
}

/**
 * Loads the overview.
 *
 * Each panel is fetched independently and a failure degrades that panel only:
 * an operator investigating an outage needs the console to stay usable.
 */
async function loadDashboard(): Promise<DashboardData> {
  const failures: string[] = [];

  const [tenant, subscription, users, flags] = await Promise.all([
    serverFetch<TenantSummary>('/tenants/current').catch((error: unknown) => {
      failures.push(error instanceof ApiError ? `Organisation: ${error.message}` : 'Organisation unavailable');
      return null;
    }),
    serverFetch<SubscriptionSummary | null>('/billing/subscription').catch(() => {
      failures.push('Subscription unavailable');
      return null;
    }),
    serverFetch<PaginatedUsers>('/users', { searchParams: { page: 1, limit: 1 } }).catch(() => {
      failures.push('User count unavailable');
      return null;
    }),
    serverFetch<Record<string, boolean>>('/feature-flags/resolved').catch(() => {
      failures.push('Feature flags unavailable');
      return null;
    }),
  ]);

  return {
    tenant,
    subscription,
    userCount: users?.pagination.totalItems ?? null,
    flags,
    failures,
  };
}

export default async function DashboardPage(): Promise<JSX.Element> {
  const { tenant, subscription, userCount, flags, failures } = await loadDashboard();

  const enabledFlags = Object.entries(flags ?? {}).filter(([, enabled]) => enabled);

  return (
    <>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Overview</h1>
      <p style={{ color: theme.color.textMuted, fontSize: 14, marginTop: theme.space(2) }}>
        {tenant ? `${tenant.name} · ${tenant.slug}` : 'Organisation details are unavailable.'}
      </p>

      {failures.length > 0 && (
        <div style={{ marginTop: theme.space(5) }}>
          <ErrorNotice
            title="Some panels could not be loaded"
            message={failures.join(' · ')}
          />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: theme.space(4),
          marginTop: theme.space(6),
        }}
      >
        <StatTile
          label="Status"
          value={tenant ? <Badge tone={toneForStatus(tenant.status)}>{titleCase(tenant.status)}</Badge> : '—'}
          hint={tenant ? `Created ${formatDateTime(tenant.createdAt)}` : undefined}
        />
        <StatTile label="Users" value={userCount ?? '—'} hint={`Seat limit ${formatLimit(tenant?.maxUsers)}`} />
        <StatTile label="Trader seats" value={formatLimit(tenant?.maxTraders)} hint="From the active plan" />
        <StatTile
          label="Plan"
          value={subscription?.plan?.name ?? 'None'}
          hint={
            subscription
              ? `${titleCase(subscription.status)} · renews ${formatDateTime(subscription.currentPeriodEnd)}`
              : 'No subscription assigned'
          }
        />
      </div>

      <div style={{ display: 'grid', gap: theme.space(5), marginTop: theme.space(6) }}>
        <Card
          title="Platform readiness"
          description="What Part 1 ships and what is intentionally switched off."
        >
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.9 }}>
            <li>Multi-tenant isolation, RBAC, audit logging and session management are live.</li>
            <li>
              Exchange credentials are stored with envelope encryption and are never returned by the
              API.
            </li>
            <li>
              Order execution is disabled platform-wide (<code>EXECUTION_ENABLED=false</code>). The
              trading engine evaluates risk only.
            </li>
            <li>Copy-trading logic and live order routing arrive in later parts.</li>
          </ul>
        </Card>

        <Card
          title="Enabled features"
          description="Resolved for this organisation from the global defaults and its overrides."
        >
          {enabledFlags.length === 0 ? (
            <p style={{ color: theme.color.textMuted, fontSize: 14, margin: 0 }}>
              No feature flags are currently enabled.
            </p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.space(2) }}>
              {enabledFlags.map(([key]) => (
                <Badge key={key} tone="info">
                  {key}
                </Badge>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
```

FILE: apps/admin-web/src/app/(console)/datasets/page.tsx

```tsx
import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, formatRelative, titleCase } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { theme, toneForStatus } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Datasets' };

/**
 * Historical dataset console (Part 7) - a foundation, deliberately read-only.
 *
 * What this page is for: an operator scanning which datasets exist, whether
 * they are VALID, what windows they cover, what their checksums are, and
 * what ingestion is doing or did and failed. Every number is metadata over
 * frozen files; nothing here reads event rows, so nothing here can become a
 * way to exfiltrate or "fix" a dataset.
 *
 * Why no buttons: ingesting, validating, quarantining and archiving all have
 * API routes with reasons and typed confirmations, and this console is not
 * where those flows get their first UI. A "Quarantine" button next to a
 * table row is one careless click away from withdrawing the dataset a
 * team's backtests were citing, and the confirmation phrase that makes that
 * safe is an interaction design decision, not a checkbox. The CLI and the
 * API carry the write paths; this page tells the truth about state.
 *
 * Every panel degrades independently: a failed fetch disables one card, not
 * the page, because the moment an operator most needs this screen is the
 * moment something is already broken.
 */

interface Paginated<T> {
  items: T[];
  pagination: { page: number; limit: number; totalItems: number };
}

interface DatasetRow {
  id: string;
  datasetKey: string;
  name: string;
  venue: string;
  marketType: string;
  symbols: string[];
  eventKinds: string[];
  granularity: string | null;
  startMicros: string;
  endMicros: string;
  status: string;
  latestVersion: number | null;
  schemaVersion: number;
  canonicalSchemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface IngestionRunRow {
  id: string;
  datasetId: string | null;
  datasetKeyHint: string | null;
  version: number | null;
  status: string;
  stage: string | null;
  errorText: string | null;
  stagingKey: string;
  sourceKind: string;
  bytesDownloaded: string;
  eventsWritten: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface ValidationRow {
  id: string;
  versionId: string;
  status: string;
  infoCount: number;
  warningCount: number;
  errorCount: number;
  fatalCount: number;
  durationMicros: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface CoverageRow {
  datasetKey: string;
  version: number;
  venue: string;
  symbol: string;
  marketType: string;
  eventKinds: string[];
  startMicros: string;
  endMicros: string;
  eventCount: number;
  contentChecksum: string;
  completeness: string;
}

interface ConsoleData {
  datasets: DatasetRow[];
  runs: IngestionRunRow[];
  coverage: CoverageRow[];
  latestValidation: ValidationRow | null;
  failures: string[];
}

async function loadConsole(): Promise<ConsoleData> {
  const failures: string[] = [];

  const describe = (label: string) => (error: unknown) => {
    failures.push(error instanceof ApiError ? `${label}: ${error.message}` : `${label} unavailable`);
    return null;
  };

  const [datasets, runs] = await Promise.all([
    serverFetch<Paginated<DatasetRow>>('/datasets', {
      searchParams: { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' },
    }).catch(describe('Datasets')),
    serverFetch<Paginated<IngestionRunRow>>('/datasets/ingestion-runs', {
      searchParams: { page: 1, limit: 10 },
    }).catch(describe('Ingestion runs')),
  ]);

  // Coverage is answered per dataset the operator can actually replay; the
  // console shows it for the newest dataset only in this foundation page -
  // a full symbol picker is UI for the next increment, not a reason to ship
  // a query that scans every symbol every render.
  let coverage: CoverageRow[] = [];
  let latestValidation: ValidationRow | null = null;
  const newest = datasets?.items[0];
  if (newest) {
    const symbol = newest.symbols[0];
    if (symbol) {
      const ranges = await serverFetch<CoverageRow[]>('/datasets/replay-ranges', {
        searchParams: { venue: newest.venue, symbol },
      }).catch(describe('Coverage'));
      coverage = ranges ?? [];
      if (newest.latestVersion !== null) {
        latestValidation = await serverFetch<ValidationRow | null>(
          `/datasets/${newest.datasetKey}/versions/${newest.latestVersion}/validation`,
        ).catch(describe('Latest validation'));
      }
    }
  }

  return {
    datasets: datasets?.items ?? [],
    runs: runs?.items ?? [],
    coverage,
    latestValidation,
    failures,
  };
}

function bytesLabel(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }
  const bytes = Number(BigInt(value));
  if (!Number.isFinite(bytes)) {
    return `${value} B`;
  }
  if (bytes >= 1 << 30) {
    return `${(bytes / (1 << 30)).toFixed(1)} GiB`;
  }
  if (bytes >= 1 << 20) {
    return `${(bytes / (1 << 20)).toFixed(1)} MiB`;
  }
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function windowLabel(startMicros: string, endMicros: string): string {
  const start = Number(BigInt(startMicros) / 1_000_000n);
  const end = Number(BigInt(endMicros) / 1_000_000n);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return `${startMicros}–${endMicros}`;
  }
  return `${formatDateTime(new Date(start * 1000).toISOString())} → ${formatDateTime(
    new Date(end * 1000).toISOString(),
  )}`;
}

function checksumShort(value: string | null | undefined): string {
  return value ? `${value.slice(0, 12)}…` : 'none';
}

export default async function DatasetsPage(): Promise<JSX.Element> {
  const { datasets, runs, coverage, latestValidation, failures } = await loadConsole();

  const validCount = datasets.filter((row) => row.status === 'VALID').length;
  const quarantinedCount = datasets.filter((row) => row.status === 'QUARANTINED').length;
  const failedRuns = runs.filter((run) => run.status === 'FAILED' || run.status === 'QUARANTINED').length;
  const bytesAcrossRuns = runs.reduce((sum, run) => sum + (Number(run.bytesDownloaded) || 0), 0);

  return (
    <>
      <PageHeader
        title="Datasets"
        description="Historical market data backing backtests. Metadata over frozen public files; no event rows are served from here, to here, or through here."
      />

      {failures.length > 0 && (
        <div style={{ marginTop: theme.space(5) }}>
          <ErrorNotice title="Some panels could not be loaded" message={failures.join(' · ')} />
        </div>
      )}

      <div style={{ marginTop: theme.space(5) }}>
        <Card
          title="What datasets are"
          description="Read this first: it is the boundary the whole screen lives inside."
        >
          <p style={{ color: theme.color.textMuted, fontSize: 13, margin: 0 }}>
            Datasets are immutable, checksummed captures of PUBLIC historical market data,
            ingested from explicit operator-triggered jobs and consumed exclusively by the
            backtest engine. A dataset version never changes after validation; new data is a
            new version. Ingestion reads public archives with no credentials of any kind, and
            no dataset, valid or otherwise, can place an order or reach a venue. Backtests over
            these datasets are simulations: BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE
            PERFORMANCE, and a dataset being VALID says its data is internally consistent, not
            that anything in it will repeat.
          </p>
        </Card>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: theme.space(4),
          marginTop: theme.space(6),
        }}
      >
        <StatTile label="Datasets" value={datasets.length} hint={`${validCount} with a VALID latest status`} />
        <StatTile label="Quarantined" value={quarantinedCount} hint="withdrawn from replay use; payloads preserved" />
        <StatTile
          label="Ingestion runs"
          value={runs.length}
          hint={`${failedRuns} failed or quarantined`}
        />
        <StatTile
          label="Bytes downloaded (shown runs)"
          value={bytesLabel(String(bytesAcrossRuns))}
          hint="public-archive fetches; no credentials involved"
        />
      </div>

      <div style={{ display: 'grid', gap: theme.space(5), marginTop: theme.space(6) }}>
        <Card
          title="Datasets"
          description="Status shown is the dataset-level rollup of its latest version. Any decision must consult the version row itself."
        >
          <DataTable
            rows={datasets}
            rowKey={(row) => row.id}
            emptyTitle="No datasets registered yet"
            emptyDescription="Ingestion is queued through POST /datasets/ingest (disabled by default) or run via the wlct-trading-datasets CLI."
            columns={[
              {
                key: 'name',
                header: 'Dataset',
                render: (row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.datasetKey}
                    </div>
                  </div>
                ),
              },
              {
                key: 'market',
                header: 'Coverage',
                render: (row) => (
                  <div>
                    <div>
                      {row.venue} · {row.symbols.join(', ')}
                    </div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.eventKinds.map(titleCase).join(' / ')} · {row.marketType}
                    </div>
                  </div>
                ),
              },
              {
                key: 'window',
                header: 'Window',
                render: (row) => (
                  <span style={{ fontSize: 12 }}>{windowLabel(row.startMicros, row.endMicros)}</span>
                ),
              },
              {
                key: 'version',
                header: 'Latest',
                render: (row) => (
                  <div style={{ display: 'flex', gap: theme.space(2), alignItems: 'center' }}>
                    <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>
                    <span style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      v{row.latestVersion ?? '—'}
                    </span>
                  </div>
                ),
              },
              {
                key: 'updated',
                header: 'Updated',
                render: (row) => <span title={row.updatedAt}>{formatRelative(row.updatedAt)}</span>,
              },
            ]}
          />
        </Card>

        <Card
          title="Replay coverage for the newest dataset"
          description="Only VALID versions appear here; a range not listed is not usable for a backtest, which is the entire point of the distinction."
        >
          <DataTable
            rows={coverage}
            rowKey={(row) => `${row.datasetKey}@v${row.version}`}
            emptyTitle="No usable coverage"
            emptyDescription="Every version for this symbol is unvalidated, quarantined or archived."
            columns={[
              {
                key: 'version',
                header: 'Version',
                render: (row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>v{row.version}</div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.datasetKey}
                    </div>
                  </div>
                ),
              },
              { key: 'symbol', header: 'Symbol', render: (row) => row.symbol },
              {
                key: 'window',
                header: 'Window',
                render: (row) => (
                  <span style={{ fontSize: 12 }}>{windowLabel(row.startMicros, row.endMicros)}</span>
                ),
              },
              {
                key: 'events',
                header: 'Events',
                render: (row) => row.eventCount.toLocaleString('en-US'),
              },
              {
                key: 'checksum',
                header: 'Content checksum',
                render: (row) => (
                  <code style={{ fontSize: 12 }} title={row.contentChecksum}>
                    {checksumShort(row.contentChecksum)}
                  </code>
                ),
              },
              {
                key: 'completeness',
                header: 'Completeness',
                render: (row) => (
                  <Badge tone={row.completeness === 'COMPLETE' ? 'success' : 'warning'}>
                    {titleCase(row.completeness)}
                  </Badge>
                ),
              },
            ]}
          />
        </Card>

        <Card
          title="Ingestion runs"
          description="Jobs live here; the work happens on the dataset worker. A FAILED or QUARANTINED run never becomes a visible version by construction."
        >
          <DataTable
            rows={runs}
            rowKey={(row) => row.id}
            emptyTitle="No ingestion jobs yet"
            emptyDescription="POST /datasets/ingest queues one once HISTORICAL_INGESTION_ENABLED is set deliberately."
            columns={[
              {
                key: 'run',
                header: 'Run',
                render: (row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.sourceKind}</div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>{row.stagingKey}</div>
                  </div>
                ),
              },
              {
                key: 'target',
                header: 'Target',
                render: (row) => (
                  <span style={{ fontSize: 12 }}>
                    {row.datasetKeyHint ?? '—'}
                    {row.version !== null ? `@v${row.version}` : ''}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <div style={{ display: 'flex', gap: theme.space(2), alignItems: 'center', flexWrap: 'wrap' }}>
                    <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>
                    {row.stage ? (
                      <span style={{ color: theme.color.textMuted, fontSize: 12 }}>{titleCase(row.stage)}</span>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'volume',
                header: 'Progress',
                render: (row) => (
                  <div style={{ fontSize: 12 }}>
                    <div>{bytesLabel(row.bytesDownloaded)} downloaded</div>
                    <div style={{ color: theme.color.textMuted }}>
                      {row.eventsWritten.toLocaleString('en-US')} events
                    </div>
                  </div>
                ),
              },
              {
                key: 'error',
                header: 'Error',
                render: (row) =>
                  row.errorText ? (
                    <span
                      style={{ color: theme.color.danger, fontSize: 12, fontFamily: 'monospace' }}
                      title={row.errorText}
                    >
                      {row.errorText.length > 60 ? `${row.errorText.slice(0, 60)}…` : row.errorText}
                    </span>
                  ) : (
                    <span style={{ color: theme.color.textMuted }}>—</span>
                  ),
              },
              {
                key: 'when',
                header: 'Created',
                render: (row) => <span title={row.createdAt}>{formatRelative(row.createdAt)}</span>,
              },
            ]}
          />
        </Card>

        {latestValidation ? (
          <Card title="Latest validation verdict" description="For the newest version of the newest dataset.">
            <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
              <Badge tone={toneForStatus(latestValidation.status)}>
                {titleCase(latestValidation.status)}
              </Badge>
              <Badge tone={latestValidation.fatalCount > 0 ? 'danger' : 'neutral'}>
                {latestValidation.fatalCount} fatal
              </Badge>
              <Badge tone={latestValidation.errorCount > 0 ? 'danger' : 'neutral'}>
                {latestValidation.errorCount} errors
              </Badge>
              <Badge tone={latestValidation.warningCount > 0 ? 'warning' : 'neutral'}>
                {latestValidation.warningCount} warnings
              </Badge>
              <Badge tone="neutral">{latestValidation.infoCount} info</Badge>
              {latestValidation.durationMicros !== null ? (
                <Badge tone="neutral">
                  {(Number(latestValidation.durationMicros) / 1000).toFixed(0)} ms
                </Badge>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
```

FILE: apps/admin-web/src/app/(console)/layout.tsx

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SignOutButton } from '@/components/sign-out-button';
import { Sidebar } from '@/components/sidebar';
import { publicEnv } from '@/lib/env';
import { decodeAccessTokenClaims, getAccessToken } from '@/lib/session';
import { theme } from '@/lib/theme';

export const dynamic = 'force-dynamic';

/**
 * Authenticated shell.
 *
 * The claims decoded here drive navigation only. Every page fetches its own
 * data through the API, which re-authorises the request; a forged cookie buys
 * an attacker a rendered sidebar and nothing else.
 */
export default function ConsoleLayout({ children }: { children: ReactNode }): JSX.Element {
  const token = getAccessToken();

  if (!token) {
    redirect('/login');
  }

  const claims = decodeAccessTokenClaims(token);

  if (!claims) {
    redirect('/login');
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '248px 1fr' }}>
      <aside
        style={{
          borderRight: `1px solid ${theme.color.border}`,
          background: theme.color.surface,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: theme.space(5), borderBottom: `1px solid ${theme.color.border}` }}>
          <Link href="/dashboard" style={{ color: theme.color.text, textDecoration: 'none' }}>
            <strong style={{ fontSize: 15 }}>{publicEnv.appName}</strong>
          </Link>
          <div style={{ color: theme.color.textMuted, fontSize: 12, marginTop: 4 }}>
            {claims.plat ? 'Platform operator' : 'Organisation admin'}
          </div>
        </div>

        <Sidebar permissions={claims.perms} isPlatformUser={claims.plat} />

        <div
          style={{
            marginTop: 'auto',
            padding: theme.space(4),
            borderTop: `1px solid ${theme.color.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: theme.space(3),
          }}
        >
          <div style={{ fontSize: 12, color: theme.color.textMuted, wordBreak: 'break-all' }}>
            Roles: {claims.roles.length > 0 ? claims.roles.join(', ') : '—'}
          </div>
          <SignOutButton />
        </div>
      </aside>

      <main style={{ padding: theme.space(8), maxWidth: 1280 }}>{children}</main>
    </div>
  );
}
```

FILE: apps/admin-web/src/app/(console)/observability/alert-controls.tsx

```tsx
'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { apiClient } from '@/lib/api-client';
import { theme } from '@/lib/theme';

/**
 * The only two controls this console is allowed to carry: acknowledge an
 * open alert, and (with ceremony) force-resolve one.
 *
 * Their meaning, stated where an operator clicks: ACKNOWLEDGE records "a
 * human has this" and changes nothing else - the alert stays as open as the
 * condition that raised it, and the gate table above the buttons keeps
 * saying NOT READY while the cause persists. FORCE-RESOLVE closes the
 * operational record despite the publisher still observing the condition;
 * it exists for the rare "the venue says it is fixed, our feed disagrees"
 * mornings, and it demands the typed phrase plus a 20-character reason
 * because it is the one button on this page that dismisses evidence.
 *
 * No optimistic state: both actions post to the API and reload the
 * server-rendered panels. A button that greys out before the server said
 * "accepted" would be the alert-panel equivalent of the trade button that
 * lies, and this platform already refused to build one of those.
 */

const FORCE_RESOLVE_PHRASE = 'FORCE RESOLVE ALERT';

interface AlertRow {
  id: string;
  state: string;
  title: string;
}

const inputStyle: CSSProperties = {
  fontSize: 13,
  padding: '6px 8px',
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  background: 'transparent',
  color: 'inherit',
  width: '100%',
};

const buttonStyle: CSSProperties = {
  fontSize: 13,
  padding: '6px 12px',
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  cursor: 'pointer',
  background: 'transparent',
  color: 'inherit',
};

const dangerButtonStyle: CSSProperties = {
  ...buttonStyle,
  borderColor: 'var(--wlct-color-danger)',
  color: 'var(--wlct-color-danger)',
};

function messageFrom(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return (error as Error).message || 'The request could not be completed.';
}

export function AlertControls({ alert }: { alert: AlertRow }): JSX.Element {
  const router = useRouter();
  const [mode, setMode] = useState<'none' | 'ack' | 'force'>('none');
  const [reason, setReason] = useState('');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = (): void => {
    setMode('none');
    setReason('');
    setPhrase('');
    setError(null);
  };

  const submit = (): void => {
    const path =
      mode === 'ack' ? `/observability/alerts/${alert.id}/acknowledge` : `/observability/alerts/${alert.id}/force-resolve`;
    const body = mode === 'ack' ? { reason } : { reason, confirmPhrase: phrase };
    startTransition(async () => {
      setError(null);
      try {
        await apiClient.post(path, body);
        close();
        router.refresh();
      } catch (caught) {
        setError(messageFrom(caught));
      }
    });
  };

  if (alert.state === 'RESOLVED') {
    return <Badge tone="neutral">resolved</Badge>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {alert.state === 'OPEN' ? (
          <button type="button" style={buttonStyle} onClick={() => setMode('ack')} disabled={pending}>
            Acknowledge
          </button>
        ) : null}
        <button type="button" style={dangerButtonStyle} onClick={() => setMode('force')} disabled={pending}>
          Force-resolve
        </button>
      </div>

      {mode !== 'none' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.md }}
        >
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {mode === 'ack'
              ? 'Acknowledge: records who has it. Does not resolve the alert or change any trading state.'
              : `Force-resolve: close WITHOUT an observed recovery. Type "${FORCE_RESOLVE_PHRASE}" and give the reason.`}
          </div>
          <input
            style={inputStyle}
            placeholder={mode === 'ack' ? 'Who/what is on it (min 5 chars)' : 'Why this may close now (min 20 chars)'}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
          />
          {mode === 'force' ? (
            <input
              style={inputStyle}
              placeholder={FORCE_RESOLVE_PHRASE}
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              maxLength={64}
            />
          ) : null}
          {error ? (
            <div style={{ color: 'var(--wlct-color-danger)', fontSize: 12 }} role="alert">
              {error}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="submit" style={buttonStyle} disabled={pending}>
              {pending ? 'Submitting...' : 'Confirm'}
            </button>
            <button type="button" style={buttonStyle} onClick={close} disabled={pending}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
```

FILE: apps/admin-web/src/app/(console)/observability/page.tsx

```tsx
import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatRelative, titleCase } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { toneForStatus, type StatusTone } from '@/lib/theme';

import { AlertControls } from './alert-controls';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Observability' };

/**
 * The operations console (Part 9): platform health, the trading-readiness
 * gate table, queues, active alerts and incident context - one page, every
 * panel independently degrading.
 *
 * What this page deliberately is not, mirroring the API surface it reads:
 * there is no control here for risk (that is the Risk page's switches and
 * the engine's gate), no order surface, no configuration editor, and no
 * way to make anything "healthy" from the browser. The two alert controls -
 * acknowledge and force-resolve - mutate only the OPERATIONAL record of
 * who-knows-what, never trading state. Acknowledging the oldest
 * risk-staleness alert on a bad night does not unlock one order, and the
 * readiness table above the buttons exists to make that visible at a glance
 * rather than something an operator has to trust.
 *
 * Data path: this server component fetches the API's /v1/observability
 * routes. The console never touches Redis or PostgreSQL directly - the
 * dashboard consumes the backend, exactly as the spec demands, because an
 * admin panel that grew its own DB credentials would be a second,
 * un-audited control plane with a friendlier UI.
 */

interface GateView {
  gate: string;
  satisfied: boolean;
  reason: string;
  source: string;
}

interface ReadinessView {
  status: string;
  tradingReady: boolean;
  evaluatedAtMicros: string;
  blockingGates: string[];
  gates: GateView[];
  enginesReporting: string[];
  note: string;
}

interface ComponentView {
  component: string;
  status: string;
  reason: string | null;
  lastSuccessAt: string | null;
  ageMicros: string | null;
  stale: boolean;
}

interface ServiceView {
  service: string;
  status: string;
  checkedAt: string | null;
  stale: boolean;
  components: ComponentView[];
}

interface AlertView {
  id: string;
  ruleId: string;
  component: string;
  scope: string | null;
  severity: string;
  state: string;
  title: string;
  message: string | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  durationSeconds: number;
  acknowledgedBy: string | null;
  resolution: string | null;
}

interface QueueView {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  paused: boolean;
  oldestWaitingAgeMs: number | null;
  alerting: boolean;
  critical: boolean;
}

interface IncidentView {
  id: string;
  title: string;
  status: string;
  severity: string | null;
  correlationId: string | null;
  openedAt: string;
  closedAt: string | null;
  links: Array<{ kind: string; targetId: string; note: string | null }>;
}

interface OverviewView {
  status: string;
  tradingReady: boolean;
  alertCounts: Record<string, number>;
  openAlerts: number;
  acknowledgedAlerts: number;
  services: ServiceView[];
  queues: QueueView[];
  note: string;
}

type Loaded<T> = { ok: T } | { error: string };

function severityTone(severity: string): StatusTone {
  if (severity === 'EMERGENCY' || severity === 'CRITICAL') {
    return 'danger';
  }
  if (severity === 'WARNING') {
    return 'warning';
  }
  return 'info';
}

async function load<T>(path: string, params?: Record<string, string | number>): Promise<Loaded<T>> {
  try {
    return { ok: await serverFetch<T>(path, { searchParams: params }) };
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: error.message };
    }
    return { error: 'This panel could not be loaded.' };
  }
}

export default async function ObservabilityPage(): Promise<JSX.Element> {
  const [overview, readiness, alerts, incidents] = await Promise.all([
    load<OverviewView>('/observability/overview'),
    load<ReadinessView>('/observability/trading-readiness'),
    load<{ items: AlertView[] }>('/observability/alerts', { limit: 50 }),
    load<{ items: IncidentView[] }>('/observability/incidents', { limit: 10 }),
  ]);

  const open = 'ok' in alerts ? alerts.ok.items.filter((alert) => alert.state !== 'RESOLVED') : [];
  const resolvedRecently =
    'ok' in alerts ? alerts.ok.items.filter((alert) => alert.state === 'RESOLVED').slice(0, 10) : [];

  return (
    <div>
      <PageHeader
        title="Observability"
        description="Platform health, trading readiness, alerts and incidents. Reports; authorises nothing."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '16px 0' }}>
        <StatTile
          label="Platform status"
          value={'ok' in overview ? overview.ok.status : 'UNKNOWN'}
          hint={'ok' in overview ? 'derived from service mirrors' : 'mirrors unavailable'}
        />
        <StatTile
          label="Trading ready"
          value={'ok' in readiness ? String(readiness.ok.tradingReady) : 'unknown'}
          hint={
            'ok' in readiness
              ? readiness.ok.blockingGates.length > 0
                ? `blocked by: ${readiness.ok.blockingGates.join(', ')}`
                : 'all gates satisfied'
              : 'readiness service unreachable'
          }
        />
        <StatTile label="Open alerts" value={'ok' in alerts ? String(open.length) : '—'} />
        <StatTile
          label="Open incidents"
          value={'ok' in incidents ? String(incidents.ok.items.filter((incident) => incident.status !== 'CLOSED').length) : '—'}
        />
      </div>

      {'error' in overview ? <ErrorNotice title="Overview" message={overview.error} /> : null}

      {'ok' in readiness ? (
        <Card title="Trading readiness (the nine gates)">
          <p style={{ opacity: 0.75, fontSize: 13, margin: '0 0 10px' }}>
            Fail-closed by construction: a gate with no fresh evidence reads <em>not satisfied</em>.
            This table never lets an order through and never stops one - enforcement lives in the
            risk engine.
          </p>
          <DataTable<GateView>
            rows={readiness.ok.gates}
            rowKey={(gate) => gate.gate}
            columns={[
              { key: 'gate', header: 'Gate', render: (gate) => titleCase(gate.gate.replace(/_/g, ' ')) },
              {
                key: 'satisfied',
                header: 'Satisfied',
                render: (gate) => <Badge tone={gate.satisfied ? 'success' : 'danger'}>{gate.satisfied ? 'yes' : 'no'}</Badge>,
              },
              { key: 'reason', header: 'Reason', render: (gate) => gate.reason },
              { key: 'source', header: 'Source', render: (gate) => gate.source },
            ]}
          />
          <p style={{ opacity: 0.6, fontSize: 12, marginTop: 8 }}>{readiness.ok.note}</p>
        </Card>
      ) : (
        <ErrorNotice title="Trading readiness" message={'error' in readiness ? readiness.error : ''} />
      )}

      {'ok' in overview ? (
        <Card title="Service mirrors">
          <DataTable<ServiceView>
            rows={overview.ok.services}
            rowKey={(service) => service.service}
            columns={[
              { key: 'service', header: 'Service', render: (service) => service.service },
              {
                key: 'status',
                header: 'Status',
                render: (service) => (
                  <Badge tone={service.stale ? 'warning' : toneForStatus(service.status)}>
                    {service.stale ? 'STALE' : service.status}
                  </Badge>
                ),
              },
              {
                key: 'components',
                header: 'Components',
                render: (service) =>
                  service.components.length === 0 ? (
                    <span style={{ opacity: 0.6 }}>no components published (mirror absent)</span>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {service.components.map((component) => (
                        <li key={component.component} style={{ fontSize: 13 }}>
                          <strong>{component.component}</strong> · {component.status}
                          {component.stale ? ' (stale)' : ''}
                          {component.reason ? ` - ${component.reason}` : ''}
                          {component.lastSuccessAt ? ` · last success ${formatRelative(component.lastSuccessAt)}` : ''}
                        </li>
                      ))}
                    </ul>
                  ),
              },
            ]}
          />
        </Card>
      ) : null}

      <Card title={`Alerts - ${open.length} open`}>
        {'error' in alerts ? (
          <ErrorNotice title="Alerts" message={alerts.error} />
        ) : (
          <>
            <DataTable<AlertView>
              rows={open}
              rowKey={(alert) => alert.id}
              columns={[
                {
                  key: 'severity',
                  header: 'Severity',
                  render: (alert) => <Badge tone={severityTone(alert.severity)}>{alert.severity}</Badge>,
                },
                {
                  key: 'condition',
                  header: 'Condition',
                  render: (alert) => (
                    <div>
                      <div>
                        <strong>{alert.title}</strong>{' '}
                        <span style={{ opacity: 0.65 }}>
                          ({alert.component}
                          {alert.scope ? `/${alert.scope}` : ''})
                        </span>
                      </div>
                      {alert.message ? <div style={{ fontSize: 12, opacity: 0.8 }}>{alert.message}</div> : null}
                    </div>
                  ),
                },
                {
                  key: 'state',
                  header: 'State',
                  render: (alert) => <Badge tone={alert.state === 'OPEN' ? 'warning' : 'info'}>{alert.state}</Badge>,
                },
                {
                  key: 'occurrences',
                  header: 'Occurrences',
                  render: (alert) => (
                    <div>
                      <div style={{ fontVariantNumeric: 'tabular-nums' }}>×{alert.occurrences}</div>
                      <div style={{ fontSize: 11, opacity: 0.7 }}>
                        for {alert.durationSeconds}s, first {formatRelative(alert.firstSeenAt)}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (alert) => <AlertControls alert={alert} />,
                },
              ]}
            />
            {resolvedRecently.length > 0 ? (
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                  Recently resolved ({resolvedRecently.length}) - kept until retention, never silently
                </summary>
                <ul style={{ fontSize: 13 }}>
                  {resolvedRecently.map((alert) => (
                    <li key={alert.id}>
                      {alert.title} · {alert.resolution ?? 'recovered'} · {formatRelative(alert.lastSeenAt)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </Card>

      {'ok' in overview ? (
        <Card title="Queues">
          <DataTable<QueueView>
            rows={overview.ok.queues}
            rowKey={(queue) => queue.name}
            columns={[
              {
                key: 'name',
                header: 'Queue',
                render: (queue) => (
                  <span>
                    {queue.name} {queue.critical ? <Badge tone="warning">execution policy</Badge> : null}
                    {queue.paused ? <Badge tone="neutral">paused</Badge> : null}
                  </span>
                ),
              },
              { key: 'waiting', header: 'Waiting', render: (queue) => String(queue.waiting) },
              { key: 'active', header: 'Active', render: (queue) => String(queue.active) },
              { key: 'failed', header: 'Failed', render: (queue) => String(queue.failed) },
              {
                key: 'oldest',
                header: 'Oldest waiting',
                render: (queue) =>
                  queue.oldestWaitingAgeMs === null ? (
                    <span style={{ opacity: 0.6 }}>empty</span>
                  ) : (
                    <span style={{ opacity: queue.alerting ? 1 : 0.75, color: queue.alerting ? 'var(--wlct-color-danger)' : undefined }}>
                      {queue.oldestWaitingAgeMs}ms{queue.alerting ? ' (over policy)' : ''}
                    </span>
                  ),
              },
            ]}
          />
          <p style={{ opacity: 0.6, fontSize: 12, marginTop: 8 }}>{overview.ok.note}</p>
        </Card>
      ) : null}

      <Card title="Incidents (recent)">
        {'error' in incidents ? (
          <ErrorNotice title="Incidents" message={incidents.error} />
        ) : incidents.ok.items.length === 0 ? (
          <p style={{ opacity: 0.7, fontSize: 13 }}>No incidents recorded. Silence here is health.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {incidents.ok.items.map((incident) => (
              <li key={incident.id} style={{ marginBottom: 10, fontSize: 13 }}>
                <strong>{incident.title}</strong> ·{' '}
                <Badge tone={incident.status === 'OPEN' ? 'warning' : 'neutral'}>{incident.status}</Badge>
                {incident.correlationId ? <span style={{ opacity: 0.7 }}> · correlation {incident.correlationId}</span> : null}
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {incident.links.map((link) => (
                    <span key={`${link.kind}-${link.targetId}`} style={{ marginRight: 10 }}>
                      {link.kind}:{link.targetId}
                      {link.note ? ` (${link.note})` : ''}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>
                  opened {formatRelative(incident.openedAt)} · full record at /v1/observability/incidents/{incident.id}
                  ; linked risk and audit rows are on their own pages
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
```

FILE: apps/admin-web/src/app/(console)/risk/page.tsx

```tsx
import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, formatRelative, titleCase } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';

import { RiskSwitchControls, RiskSwitchRowActions } from './switch-controls';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Risk' };

/**
 * The risk console (Part 8) - the posture screen, plus the two controls that
 * belong on ANY screen: pulling a stop, and (with ceremony) clearing one.
 *
 * What this page is, precisely: a viewer of the mirrored risk state plus a
 * thin front-end for the API's kill-switch lifecycle. Every figure shown is
 * the latest SYNCED snapshot metadata, timestamped as such - the console
 * never claims a live venue read, because it never performs one. The panel
 * labelled "stale" is honest about staleness, and the whole page says the
 * sentence the docs say: risk controls reduce operational risk but cannot
 * guarantee against all losses.
 *
 * What this page is NOT: an order surface. There is no order queue here, no
 * approve/reject button, no "submit anyway", and no config editor. Limit
 * revisions are a CLI/API act with a typed confirmation and a reason; a
 * form on a status dashboard is how limits get "quickly bumped" at 3am by
 * whoever has the page open. Switches are different: pulling one is the one
 * action that can never make the system more dangerous, which is exactly
 * why the ENGAGE control sits here and the CLEAR control carries a typed
 * phrase and a prior acknowledgement.
 *
 * Panel-level degradation, same rule as datasets: one failed fetch disables
 * one card, not the page.
 */

interface RiskStatus {
  engineEnabled: boolean;
  failClosed: boolean;
  maxRiskStateAgeMs: number;
  snapshotRefreshMs: number;
  refreshOutpacesStaleness: boolean;
  platformCeilings: Record<string, string | number>;
  engagedSwitchCount: number;
  triggeredProtectionCount: number;
  latestSnapshotPerAccount: Array<{
    id: string;
    accountId: string;
    snapshotVersion: string;
    capturedAt: string;
    equity: string | null;
    accountGrossNotional: string | null;
    netDailyPnl: string | null;
    openOrderCount: number | null;
    staleSources: string[];
    isComplete: boolean;
    isSimulated: boolean;
  }>;
  staleAccounts: string[];
  eventsLast24hBySeverity: Record<string, number>;
  note: string;
}

interface RiskSwitchRow {
  id: string;
  scope: string;
  target: string | null;
  isEngaged: boolean;
  status: string;
  reason: string | null;
  triggeredByRule: string | null;
  severity: string | null;
  requiresExplicitClear: boolean;
  engagedAt: string | null;
  acknowledgedAt: string | null;
  clearedAt: string | null;
  updatedAt: string;
}

interface RiskEventRow {
  id: string;
  createdAt: string;
  eventType: string;
  severity: string;
  message: string;
  ruleId: string | null;
  scope: string | null;
  accountId: string | null;
  isSimulated: boolean;
}

interface AccountRow {
  id: string;
  label: string;
  venue: string;
  status: string;
  tradingMode: string;
  isSandbox: boolean;
}

async function loadConsole(): Promise<{
  status: RiskStatus | null;
  switches: RiskSwitchRow[];
  events: RiskEventRow[];
  accounts: AccountRow[];
  failures: string[];
}> {
  const failures: string[] = [];
  const track = async <T,>(label: string, promise: Promise<T>): Promise<T | null> => {
    try {
      return await promise;
    } catch (error) {
      failures.push(`${label}: ${(error as Error).message}`);
      return null;
    }
  };

  const [status, switches, eventsPage, accountsPage] = await Promise.all([
    track('risk status', serverFetch<RiskStatus>('/risk/status')),
    track('kill switches', serverFetch<RiskSwitchRow[]>('/risk/kill-switches')),
    track('risk events', serverFetch<{ items: RiskEventRow[] }>('/risk/events', {
      searchParams: { limit: 25, sortOrder: 'desc', sortBy: 'createdAt' },
    })),
    track(
      'trading accounts',
      serverFetch<{ items: AccountRow[] }>('/execution/accounts', { searchParams: { limit: 50 } }),
    ),
  ]);

  if (status && !status.refreshOutpacesStaleness) {
    // Not a fetch failure - a configuration fault the page must make loud.
    failures.push(
      'deployment misconfiguration: snapshot refresh cadence does not outpace the staleness budget',
    );
  }

  return {
    status,
    switches: switches ?? [],
    events: eventsPage?.items ?? [],
    accounts: accountsPage?.items ?? [],
    failures,
  };
}

const severityTone: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  CRITICAL: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'info',
  INFO: 'neutral',
};

function switchTone(row: RiskSwitchRow): 'danger' | 'warning' | 'neutral' {
  if (!row.isEngaged) {
    return 'neutral';
  }
  if (row.status === 'TRIGGERED') {
    return 'danger';
  }
  if (row.status === 'ACKNOWLEDGED') {
    return 'warning';
  }
  return 'warning';
}

export default async function RiskPage(): Promise<JSX.Element> {
  const { status, switches, events, accounts, failures } = await loadConsole();
  const engaged = switches.filter((row) => row.isEngaged);
  const triggered = engaged.filter((row) => row.requiresExplicitClear);
  const staleAccounts = status?.staleAccounts ?? [];
  const severityCounts = status?.eventsLast24hBySeverity ?? {};

  return (
    <>
      <PageHeader
        title="Risk"
        description="Kill switches, mirrored risk state, and the deployment's own safety envelope. Figures are the latest synced snapshot metadata - timestamped, never a live venue read."
      />

      <div style={{ marginTop: theme.space(5) }}>
        <Card
          title="Read this first"
          description="What this screen can and cannot promise."
        >
          <p style={{ color: theme.color.textMuted, fontSize: 13, margin: 0 }}>
            {status?.note ??
              'Risk controls reduce operational risk but cannot guarantee against all losses.'}{' '}
            Engaging a switch here stops new risk from being taken once the engine syncs; the
            durable row is the safety, and the engine fail-closes if it cannot see the risk
            state at all. Clearing a switch that automatic protection triggered requires an
            acknowledgement and a typed confirmation, and neither is bypassable from this
            page - if the UI ever seems to offer a one-click clear, that is a bug worth
            reporting immediately.
          </p>
        </Card>
      </div>

      {failures.length > 0 && (
        <div style={{ marginTop: theme.space(5) }}>
          <ErrorNotice title="Some panels could not be loaded" message={failures.join(' · ')} />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: theme.space(4),
          marginTop: theme.space(6),
        }}
      >
        <StatTile
          label="Risk engine"
          value={status ? (status.engineEnabled ? 'ON' : 'OFF') : '—'}
          hint={
            status
              ? status.engineEnabled
                ? 'full rule catalog in the order path'
                : 'local tooling mode; a production deployment must boot ON'
              : 'status unavailable'
          }
        />
        <StatTile
          label="Fail-closed"
          value={status ? (status.failClosed ? 'forced' : '?') : '—'}
          hint="RISK_FAIL_CLOSED has exactly one legal value: true"
        />
        <StatTile
          label="Engaged switches"
          value={engaged.length}
          hint={`${triggered.length} triggered by automatic protection`}
        />
        <StatTile
          label="Stale mirrors"
          value={staleAccounts.length}
          hint="accounts whose snapshot mirror exceeds 2× the refresh cadence"
        />
        <StatTile
          label="Events (24h)"
          value={Object.values(severityCounts).reduce((sum, n) => sum + n, 0)}
          hint={
            [
              severityCounts.CRITICAL ? `${severityCounts.CRITICAL} critical` : null,
              severityCounts.HIGH ? `${severityCounts.HIGH} high` : null,
            ]
              .filter(Boolean)
              .join(', ') || 'no severe events'
          }
        />
      </div>

      <div style={{ display: 'grid', gap: theme.space(5), marginTop: theme.space(6) }}>
        <Card
          title="Kill switches"
          description="The engine reads these rows; a switch engaged here halts the scope, a triggered switch stays down until an operator acknowledges and clears it."
          actions={
            <RiskSwitchControls
              accounts={accounts.map((account) => ({ id: account.id, label: account.label }))}
            />
          }
        >
          <DataTable
            rows={switches}
            rowKey={(row) => row.id}
            emptyTitle="No switches engaged or recorded"
            emptyDescription="Nothing is halted. The absence of rows is health here, not missing data."
            columns={[
              { key: 'scope', header: 'Scope', render: (row) => <Badge>{row.scope}</Badge> },
              {
                key: 'target',
                header: 'Target',
                render: (row) => <code style={{ fontSize: 12 }}>{row.target ?? '—'}</code>,
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <Badge tone={switchTone(row)}>
                    {titleCase(row.status.toLowerCase())}
                    {row.requiresExplicitClear ? ' · explicit-clear' : ''}
                  </Badge>
                ),
              },
              {
                key: 'rule',
                header: 'Triggered by',
                render: (row) => row.triggeredByRule ?? 'manual',
              },
              {
                key: 'reason',
                header: 'Reason',
                render: (row) => (
                  <span style={{ color: theme.color.textMuted, fontSize: 12 }}>
                    {row.reason ?? '—'}
                  </span>
                ),
              },
              {
                key: 'engaged',
                header: 'Engaged',
                render: (row) => (row.engagedAt ? formatRelative(row.engagedAt) : '—'),
              },
              {
                key: 'acknowledged',
                header: 'Acknowledged',
                render: (row) => (row.acknowledgedAt ? formatRelative(row.acknowledgedAt) : '—'),
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (row) => <RiskSwitchRowActions row={row} />,
              },
            ]}
          />
        </Card>

        <Card
          title="Mirror freshness by account"
          description="Latest synced snapshot metadata. A missing or stale row means the engine will deny orders for lack of trustworthy state - that is the fail-closed design, not an outage of this page."
        >
          <DataTable
            rows={status?.latestSnapshotPerAccount ?? []}
            rowKey={(row) => row.id}
            emptyTitle="No snapshot mirrors yet"
            emptyDescription="Every account shows as stale until the risk-state worker has synced at least once."
            columns={[
              {
                key: 'account',
                header: 'Account',
                render: (row) => (
                  <code style={{ fontSize: 12 }}>
                    {accounts.find((account) => account.id === row.accountId)?.label ??
                      row.accountId.slice(0, 8)}
                  </code>
                ),
              },
              { key: 'version', header: 'Snapshot', render: (row) => row.snapshotVersion },
              {
                key: 'captured',
                header: 'Captured',
                render: (row) => (
                  <span
                    title={formatDateTime(row.capturedAt)}
                    style={{
                      color: staleAccounts.includes(row.accountId)
                        ? 'var(--wlct-color-danger)'
                        : undefined,
                    }}
                  >
                    {formatRelative(row.capturedAt)}
                    {staleAccounts.includes(row.accountId) ? ' · STALE' : ''}
                  </span>
                ),
              },
              {
                key: 'equity',
                header: 'Equity',
                align: 'right',
                render: (row) => row.equity ?? '—',
              },
              {
                key: 'gross',
                header: 'Gross notional',
                align: 'right',
                render: (row) => row.accountGrossNotional ?? '—',
              },
              {
                key: 'pnl',
                header: 'Net day PnL',
                align: 'right',
                render: (row) => row.netDailyPnl ?? '—',
              },
              {
                key: 'open',
                header: 'Open orders',
                align: 'right',
                render: (row) => row.openOrderCount ?? '—',
              },
              {
                key: 'sim',
                header: 'Source',
                render: (row) =>
                  row.isSimulated ? <Badge tone="info">simulated</Badge> : <Badge>live mirror</Badge>,
              },
            ]}
          />
        </Card>

        <Card
          title="Platform ceilings (deployment envelope)"
          description="GLOBAL-scope API writes above these values are refused outright; child scopes can only tighten below them."
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: theme.space(3),
            }}
          >
            {Object.entries(status?.platformCeilings ?? {}).map(([key, value]) => (
              <div
                key={key}
                style={{
                  border: `1px solid ${theme.color.border}`,
                  borderRadius: theme.radius.md,
                  padding: theme.space(3),
                }}
              >
                <div style={{ fontSize: 11, color: theme.color.textMuted }}>{key}</div>
                <div style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
                  {String(value)}
                </div>
              </div>
            ))}
            {!status && (
              <p style={{ color: theme.color.textMuted, margin: 0 }}>
                Ceilings unavailable while the status panel fails to load.
              </p>
            )}
          </div>
        </Card>

        <Card
          title="Recent risk events"
          description="Decisions the engine recorded: breaches, refusals, protection actions, sync faults. Simulated rows (paper/backtest) are labelled and never counted as live."
        >
          <DataTable
            rows={events}
            rowKey={(row) => row.id}
            emptyTitle="No risk events recorded"
            columns={[
              {
                key: 'when',
                header: 'When',
                render: (row) => (
                  <span title={formatDateTime(row.createdAt)}>{formatRelative(row.createdAt)}</span>
                ),
              },
              {
                key: 'severity',
                header: 'Severity',
                render: (row) => (
                  <Badge tone={severityTone[row.severity] ?? 'neutral'}>{row.severity}</Badge>
                ),
              },
              { key: 'type', header: 'Event', render: (row) => titleCase(row.eventType.toLowerCase()) },
              {
                key: 'rule',
                header: 'Rule / scope',
                render: (row) => (
                  <span style={{ fontSize: 12 }}>
                    {row.ruleId ?? '—'}
                    {row.scope ? ` · ${row.scope}` : ''}
                  </span>
                ),
              },
              {
                key: 'message',
                header: 'Detail',
                render: (row) => (
                  <span style={{ color: theme.color.textMuted, fontSize: 12 }}>
                    {row.message.slice(0, 140)}
                    {row.isSimulated ? ' · simulated' : ''}
                  </span>
                ),
              },
            ]}
          />
        </Card>

        <Card
          title="Trading accounts"
          description="IDs needed as switch targets. Live-armed accounts behave exactly like paper ones here: the risk gate is identical, and it is the reason this page can speak about both."
        >
          <DataTable
            rows={accounts}
            rowKey={(row) => row.id}
            emptyTitle="No trading accounts"
            columns={[
              { key: 'label', header: 'Label', render: (row) => row.label },
              { key: 'venue', header: 'Venue', render: (row) => row.venue },
              {
                key: 'mode',
                header: 'Mode',
                render: (row) => (
                  <Badge tone={row.tradingMode === 'LIVE' && !row.isSandbox ? 'danger' : 'info'}>
                    {row.tradingMode}
                    {row.isSandbox ? ' · sandbox' : ''}
                  </Badge>
                ),
              },
              { key: 'status', header: 'Status', render: (row) => titleCase(row.status.toLowerCase()) },
              {
                key: 'id',
                header: 'Account id (switch target)',
                render: (row) => <code style={{ fontSize: 12 }}>{row.id}</code>,
              },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
```

FILE: apps/admin-web/src/app/(console)/risk/switch-controls.tsx

```tsx
'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { apiClient } from '@/lib/api-client';
import { theme } from '@/lib/theme';

/**
 * The two controls the risk console is allowed to carry.
 *
 * Splitting them out as one small client island keeps the rule visible in
 * the code, not just the docs: this file can engage a stop, acknowledge a
 * trigger, and clear a switch. It cannot edit a limit, submit, cancel or
 * approve an order, and it holds no data beyond what the server page hands
 * it. Every action posts to the API and reloads the server-rendered panels;
 * there is no optimistic switch state anywhere, because a green tick that
 * the engine has not seen yet is the one lie this screen must never tell.
 *
 * The clear form asks for the typed confirmation phrase and a >=20-character
 * reason because the API demands exactly that, not as decoration: an operator
 * who cannot be bothered to type the phrase is an operator telling the system
 * they should not be clearing the protection yet.
 */

export interface SwitchRow {
  id: string;
  scope: string;
  target: string | null;
  isEngaged: boolean;
  status: string;
  requiresExplicitClear: boolean;
}

const CLEAR_PHRASE = 'CLEAR RISK PROTECTION';

const inputStyle: CSSProperties = {
  fontSize: 13,
  padding: '6px 8px',
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  background: 'transparent',
  color: 'inherit',
  width: '100%',
};

const buttonStyle: CSSProperties = {
  fontSize: 13,
  padding: '6px 12px',
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  cursor: 'pointer',
  background: 'transparent',
  color: 'inherit',
};

const dangerButtonStyle: CSSProperties = {
  ...buttonStyle,
  borderColor: 'var(--wlct-color-danger)',
  color: 'var(--wlct-color-danger)',
};

function messageFrom(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return (error as Error).message || 'The request could not be completed.';
}

// -----------------------------------------------------------------------------
// Engage
// -----------------------------------------------------------------------------

export function RiskSwitchControls({
  accounts,
}: {
  accounts: Array<{ id: string; label: string }>;
}): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'ACCOUNT' | 'STRATEGY' | 'SYMBOL'>('ACCOUNT');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    setError(null);
    setNote(null);
    startTransition(async () => {
      try {
        await apiClient.post('/risk/kill-switches/engage', {
          scope,
          target: target.trim(),
          reason: reason.trim(),
        });
        setNote('Switch engaged. The engine applies it on its next sync; the durable row is already in force.');
        setReason('');
        setTarget('');
        setOpen(false);
        router.refresh();
      } catch (caught) {
        setError(messageFrom(caught));
      }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: theme.space(2) }}>
      <button type="button" style={dangerButtonStyle} onClick={() => setOpen((v) => !v)}>
        {open ? 'Cancel' : 'Engage a stop'}
      </button>
      {note && (
        <span style={{ fontSize: 12, color: 'var(--wlct-color-success, inherit)' }}>{note}</span>
      )}
      {open && (
        <div
          style={{
            display: 'grid',
            gap: theme.space(2),
            width: 360,
            padding: theme.space(3),
            border: `1px solid ${theme.color.border}`,
            borderRadius: theme.radius.md,
            textAlign: 'left',
          }}
        >
          <label style={{ fontSize: 12, color: theme.color.textMuted }}>
            Scope
            <select
              style={inputStyle}
              value={scope}
              onChange={(event) => {
                setScope(event.target.value as 'ACCOUNT' | 'STRATEGY' | 'SYMBOL');
                setTarget('');
              }}
            >
              <option value="ACCOUNT">ACCOUNT - halt one trading account</option>
              <option value="STRATEGY">STRATEGY - halt one strategy instance</option>
              <option value="SYMBOL">SYMBOL - halt one symbol for the org</option>
            </select>
          </label>
          <label style={{ fontSize: 12, color: theme.color.textMuted }}>
            Target
            {scope === 'ACCOUNT' ? (
              <select style={inputStyle} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">choose an account…</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label} ({account.id.slice(0, 8)})
                  </option>
                ))}
              </select>
            ) : (
              <input
                style={inputStyle}
                value={target}
                placeholder={scope === 'SYMBOL' ? 'e.g. BTC-USDT' : 'strategy id (uuid)'}
                onChange={(e) => setTarget(e.target.value)}
              />
            )}
          </label>
          <label style={{ fontSize: 12, color: theme.color.textMuted }}>
            Reason (at least 10 characters, audited)
            <textarea
              style={{ ...inputStyle, minHeight: 64 }}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--wlct-color-danger)' }}>{error}</p>}
          <button
            type="button"
            style={dangerButtonStyle}
            disabled={pending || target.trim() === '' || reason.trim().length < 10}
            onClick={submit}
          >
            {pending ? 'Engaging…' : 'Engage switch'}
          </button>
          <p style={{ margin: 0, fontSize: 11, color: theme.color.textMuted }}>
            Engaging halts new risk in scope for every strategy attached to it. Risk-reducing
            orders keep flowing by design - a halt that traps positions open is a worse failure
            than a halt.
          </p>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Per-row acknowledge / clear
// -----------------------------------------------------------------------------

export function RiskSwitchRowActions({ row }: { row: SwitchRow }): JSX.Element {
  const router = useRouter();
  const [mode, setMode] = useState<'none' | 'ack' | 'clear'>('none');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!row.isEngaged) {
    return <span style={{ fontSize: 12, color: theme.color.textMuted }}>—</span>;
  }

  const close = (): void => {
    setMode('none');
    setReason('');
    setConfirm('');
    setError(null);
  };

  const run = (path: string, body: Record<string, string>): void => {
    setError(null);
    startTransition(async () => {
      try {
        await apiClient.post(path, body);
        close();
        router.refresh();
      } catch (caught) {
        setError(messageFrom(caught));
      }
    });
  };

  if (mode === 'none') {
    return (
      <span style={{ display: 'inline-flex', gap: theme.space(2) }}>
        {row.status === 'TRIGGERED' && (
          <button type="button" style={buttonStyle} onClick={() => setMode('ack')}>
            Acknowledge
          </button>
        )}
        <button type="button" style={buttonStyle} onClick={() => setMode('clear')}>
          Clear…
        </button>
      </span>
    );
  }

  const reasonReady = reason.trim().length >= (mode === 'ack' ? 10 : 20);
  const clearReady = mode === 'ack' || confirm === CLEAR_PHRASE;

  return (
    <div style={{ display: 'grid', gap: theme.space(1), minWidth: 260, textAlign: 'left' }}>
      <Badge tone={mode === 'clear' ? 'warning' : 'info'}>
        {mode === 'ack'
          ? 'Acknowledge: what did you review?'
          : row.requiresExplicitClear
            ? 'Clear: this ends an automatic halt'
            : 'Clear: this releases a manual halt'}
      </Badge>
      <textarea
        style={{ ...inputStyle, minHeight: 48 }}
        placeholder={
          mode === 'ack'
            ? 'min 10 chars - what was checked'
            : 'min 20 chars - why the halt can end now'
        }
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {mode === 'clear' && (
        <input
          style={inputStyle}
          placeholder={`type exactly: ${CLEAR_PHRASE}`}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      )}
      {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--wlct-color-danger)' }}>{error}</p>}
      <span style={{ display: 'inline-flex', gap: theme.space(2) }}>
        <button
          type="button"
          style={dangerButtonStyle}
          disabled={pending || !reasonReady || !clearReady}
          onClick={() =>
            run(
              `/risk/kill-switches/${row.id}/${mode === 'ack' ? 'acknowledge' : 'clear'}`,
              mode === 'ack' ? { reason: reason.trim() } : { reason: reason.trim(), confirm },
            )
          }
        >
          {pending ? 'Working…' : mode === 'ack' ? 'Record acknowledgement' : 'Clear switch'}
        </button>
        <button type="button" style={buttonStyle} onClick={close}>
          Cancel
        </button>
      </span>
      {mode === 'clear' && row.requiresExplicitClear && row.status === 'TRIGGERED' && (
        <p style={{ margin: 0, fontSize: 11, color: theme.color.textMuted }}>
          The API will refuse a clear until this switch is acknowledged first - there is no
          single-step path from an engine trip back to trading.
        </p>
      )}
    </div>
  );
}
```

FILE: apps/admin-web/src/app/(console)/roles/page.tsx

```tsx
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
```

FILE: apps/admin-web/src/app/(console)/settings/page.tsx

```tsx
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
```

FILE: apps/admin-web/src/app/(console)/slo/page.tsx

```tsx
import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatRelative } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import type { StatusTone } from '@/lib/theme';

import { EvaluateAllButton, FlushExportButton, RunNowButton, SloConfigForm } from './slo-controls';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Service objectives' };

/**
 * The error-budget console (Part 10): every SLO with its latest evaluation,
 * the dual-window burn verdicts, the readiness rollup, and the telemetry
 * posture that produces the numbers.
 *
 * What this page can and cannot do, stated in the same terms the API uses:
 * it publishes NEW definition VERSIONS (append-only, audited, risk-reducing
 * or cosmetic - it can never rewrite or delete an old promise), it asks the
 * evaluator to look now, and it runs one export tick. It cannot arm a fault
 * (that is an environment decision the API refuses to expose), it cannot
 * edit a stored version, and no panel here authorises anything: the
 * numbers measure and page, and the trading gates read the risk plane, not
 * this one. That is the whole contract of the telemetry layer, mirrored
 * where a human can read it.
 *
 * Data path: server component through serverFetch, like every other console
 * page. The browser never holds a bearer token and the console never talks
 * to Redis or Postgres directly.
 */

interface SloDefinitionView {
  sloId: string;
  version: number;
  service: string;
  owner: string;
  description: string;
  indicator: string;
  objective: string;
  objectivePpm: number;
  allowedPpm: number;
  windowMinutes: number;
  shortWindowMinutes: number;
  goodEvent: string;
  badEvent: string;
  warningBurnPpm: number;
  criticalBurnPpm: number;
  maxAgeMicros: string | null;
  latencyThresholdMicros: string | null;
  enabled: boolean;
  checksum: string;
  createdAt: string;
  updatedAt: string;
}

interface SloEvaluationView {
  sloId: string;
  version: number;
  checksum: string;
  indicator: string;
  service: string;
  state: string;
  evaluatedAtMicros: string;
  windowMinutes: number;
  shortWindowMinutes: number;
  targetPpm: number;
  actualPpm: number | null;
  budgetTotalEvents: number;
  budgetConsumedEvents: number;
  budgetRemainingEvents: number;
  remainingRatioPpm: number | null;
  longBurnPpm: number | null;
  shortBurnPpm: number | null;
  alertKind: string;
  samplesGood: number;
  samplesBad: number;
  dataComplete: boolean;
  reason: string | null;
}

interface SloStatusView {
  definition: SloDefinitionView;
  latest: SloEvaluationView | null;
  burnAlerting: boolean;
}

interface SloReadinessView {
  evaluatedAtMicros: string;
  total: number;
  byState: Record<string, number>;
  worstRemainingRatioPpm: number | null;
  maxLongBurnPpm: number | null;
  pagingSloIds: string[];
  unmeasuredSloIds: string[];
  note: string;
}

interface TracingStatusView {
  enabled: boolean;
  endpointConfigured: boolean;
  sampleRatio: number;
  priorityOperations: string[];
  bufferedSpans: number;
  exportedTotal: number;
  droppedTotal: number;
  consecutiveExportFailures: number;
  lastExportOutcome: string | null;
}

interface FaultsStatusView {
  enabled: boolean;
  production: boolean;
  activePoints: string[];
}

type Loaded<T> = { ok: T } | { error: string };

async function load<T>(path: string, params?: Record<string, string | number | boolean>): Promise<Loaded<T>> {
  try {
    return { ok: await serverFetch<T>(path, { searchParams: params }) };
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: error.message };
    }
    return { error: 'This panel could not be loaded.' };
  }
}

function stateTone(state: string | null | undefined): StatusTone {
  switch (state) {
    case 'HEALTHY':
      return 'success';
    case 'WARNING':
      return 'warning';
    case 'CRITICAL':
    case 'EXHAUSTED':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** ppm -> "48.2%" style rendering; null stays an honest em dash, never 0. */
function ppmToPercent(ppm: number | null | undefined): string {
  if (ppm === null || ppm === undefined) {
    return '—';
  }
  return `${(ppm / 10_000).toFixed(1)}%`;
}

function ppmToTimes(ppm: number | null | undefined): string {
  if (ppm === null || ppm === undefined) {
    return '—';
  }
  return `${(ppm / 1_000_000).toFixed(2)}×`;
}

function windowLabel(minutes: number): string {
  if (minutes % 1440 === 0) {
    return `${String(minutes / 1440)}d`;
  }
  if (minutes % 60 === 0) {
    return `${String(minutes / 60)}h`;
  }
  return `${String(minutes)}m`;
}

export default async function SloPage(): Promise<JSX.Element> {
  const [statuses, readiness, tracing, faults] = await Promise.all([
    load<{ items: SloStatusView[]; total: number }>('/operational/slos', { includeDisabled: true }),
    load<SloReadinessView>('/operational/slos/readiness'),
    load<TracingStatusView>('/operational/tracing'),
    load<FaultsStatusView>('/operational/faults'),
  ]);

  const rows = 'ok' in statuses ? statuses.ok.items : [];
  const evidenced = rows.filter((row) => row.latest !== null);
  const alerting = 'ok' in readiness ? readiness.ok.pagingSloIds : [];
  const unmeasured = 'ok' in readiness ? readiness.ok.unmeasuredSloIds : [];

  return (
    <div>
      <PageHeader
        title="Service objectives"
        description="Error budgets, burn rates and the telemetry posture behind them. Reports and pages; authorises nothing."
        actions={<EvaluateAllButton />}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          margin: '16px 0',
        }}
      >
        <StatTile
          label="Objectives"
          value={rows.length > 0 ? String(rows.length) : '—'}
          hint={`${String(evidenced.length)} with at least one evaluation`}
        />
        <StatTile
          label="Paging now"
          value={'ok' in readiness ? String(readiness.ok.pagingSloIds.length) : '—'}
          hint={
            alerting.length > 0
              ? alerting.join(', ')
              : 'no dual-window burn condition currently met'
          }
        />
        <StatTile
          label="Worst remaining budget"
          value={'ok' in readiness ? ppmToPercent(readiness.ok.worstRemainingRatioPpm) : '—'}
          hint="the floor, not the average: one exhausted objective is the headline"
        />
        <StatTile
          label="Max long burn"
          value={'ok' in readiness ? ppmToTimes(readiness.ok.maxLongBurnPpm) : '—'}
          hint="burn multiplier over the long window"
        />
        <StatTile
          label="Unmeasured"
          value={'ok' in readiness ? String(readiness.ok.unmeasuredSloIds.length) : '—'}
          hint={unmeasured.length > 0 ? unmeasured.join(', ') : 'every objective has current evidence'}
        />
      </div>

      {'error' in readiness ? (
        <ErrorNotice title="Readiness rollup" message={readiness.error} />
      ) : (
        <Card
          title="Rollup"
          description={`Evaluated at ${formatRelative(
            new Date(Number(BigInt(readiness.ok.evaluatedAtMicros) / 1000n)).toISOString(),
          )}. States below count the LATEST evaluation of each definition.`}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {['HEALTHY', 'WARNING', 'CRITICAL', 'EXHAUSTED', 'UNKNOWN'].map((state) => (
              <Badge key={state} tone={stateTone(state)}>
                {state}: {String(readiness.ok.byState[state] ?? 0)}
              </Badge>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)', margin: 0 }}>
            {readiness.ok.note}
          </p>
        </Card>
      )}

      <div style={{ marginTop: 16 }}>
        {'error' in statuses ? (
          <ErrorNotice title="Service objectives" message={statuses.error} />
        ) : (
          <Card
            title="Objectives"
            description="Latest published version and latest evaluation per objective. A row whose latest tick says dataComplete=false carries an explicit ⚠ - a thin window is reported, not averaged away."
          >
            <DataTable<SloStatusView>
              rows={rows}
              rowKey={(row) => row.definition.sloId}
              emptyTitle="No objectives configured"
              emptyDescription="The platform ships a default catalog; this tenant has none published yet."
              columns={[
                {
                  key: 'slo',
                  header: 'Objective',
                  render: (row) => (
                    <div>
                      <strong style={{ fontSize: 13 }}>{row.definition.sloId}</strong>
                      <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>
                        {row.definition.service} · {row.definition.indicator} · v
                        {String(row.definition.version)}
                        {row.definition.enabled ? '' : ' · disabled'}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'promise',
                  header: 'Promise',
                  render: (row) => (
                    <div style={{ fontSize: 13 }}>
                      {row.definition.objective}% / {windowLabel(row.definition.windowMinutes)}
                      <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>
                        short {windowLabel(row.definition.shortWindowMinutes)} · allows{' '}
                        {ppmToPercent(row.definition.allowedPpm)}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'state',
                  header: 'State',
                  render: (row) => (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Badge tone={stateTone(row.latest?.state ?? null)}>
                        {row.latest?.state ?? 'NO-EVAL'}
                      </Badge>
                      {row.burnAlerting ? <Badge tone="danger">paging</Badge> : null}
                      {row.latest !== null && !row.latest.dataComplete ? (
                        <Badge tone="warning">⚠ thin window</Badge>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: 'budget',
                  header: 'Budget left',
                  align: 'right',
                  render: (row) => (
                    <div style={{ fontSize: 13, textAlign: 'right' }}>
                      {ppmToPercent(row.latest?.remainingRatioPpm)}
                      <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>
                        {row.latest === null
                          ? 'no evidence yet'
                          : `${String(row.latest.budgetConsumedEvents)} of ${String(
                              row.latest.budgetTotalEvents,
                            )} events burned`}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'burn',
                  header: 'Burn (short / long)',
                  align: 'right',
                  render: (row) => (
                    <div style={{ fontSize: 13, textAlign: 'right' }}>
                      {ppmToTimes(row.latest?.shortBurnPpm)} / {ppmToTimes(row.latest?.longBurnPpm)}
                      <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>
                        {row.latest === null
                          ? '—'
                          : `pages at ${ppmToTimes(row.definition.criticalBurnPpm)} both windows`}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'samples',
                  header: 'Samples (g/b)',
                  align: 'right',
                  render: (row) => (
                    <div style={{ fontSize: 13, textAlign: 'right' }}>
                      {row.latest === null
                        ? '—'
                        : `${String(row.latest.samplesGood)} / ${String(row.latest.samplesBad)}`}
                      <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>
                        {row.latest?.reason ??
                          (row.latest === null ? 'not evaluated yet' : 'ok')}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'evaluated',
                  header: 'Evaluated',
                  render: (row) => (
                    <div style={{ fontSize: 13 }}>
                      {row.latest === null
                        ? 'never'
                        : formatRelative(
                            new Date(
                              Number(BigInt(row.latest.evaluatedAtMicros) / 1000n),
                            ).toISOString(),
                          )}
                    </div>
                  ),
                },
                {
                  key: 'controls',
                  header: '',
                  align: 'right',
                  render: (row) => (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <RunNowButton sloId={row.definition.sloId} />
                      <SloConfigForm definition={row.definition} />
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
          marginTop: 16,
        }}
      >
        <Card
          title="Telemetry posture"
          description="What THIS api process exports and where it goes, as configured. The endpoint is reported as configured/not - URLs belong in deployment, not panels."
          actions={<FlushExportButton />}
        >
          {'error' in tracing ? (
            <ErrorNotice title="Tracing status" message={tracing.error} />
          ) : (
            <dl style={{ fontSize: 13, margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px' }}>
              <dt>Export</dt>
              <dd style={{ margin: 0 }}>
                {tracing.ok.enabled
                  ? tracing.ok.endpointConfigured
                    ? 'on'
                    : 'on, but nowhere to go (counts as drops)'
                  : 'off'}
              </dd>
              <dt>Sample ratio</dt>
              <dd style={{ margin: 0 }}>{tracing.ok.sampleRatio}</dd>
              <dt>Always-traced operations</dt>
              <dd style={{ margin: 0 }}>
                {tracing.ok.priorityOperations.length > 0
                  ? tracing.ok.priorityOperations.join(', ')
                  : 'none'}
              </dd>
              <dt>Buffered / exported / dropped</dt>
              <dd style={{ margin: 0 }}>
                {String(tracing.ok.bufferedSpans)} / {String(tracing.ok.exportedTotal)} /{' '}
                {String(tracing.ok.droppedTotal)}
              </dd>
              <dt>Consecutive failures</dt>
              <dd style={{ margin: 0 }}>
                {String(tracing.ok.consecutiveExportFailures)}
                {tracing.ok.lastExportOutcome !== null
                  ? ` · last: ${tracing.ok.lastExportOutcome}`
                  : ''}
              </dd>
            </dl>
          )}
        </Card>

        <Card
          title="Fault injection"
          description="Armed only through environment configuration, only outside production; the API exposes no arm lever, so the only runtime operation is consumption at the instrumented points. This card is why 'absence of injected failure' and 'no injection here' are different sentences."
        >
          {'error' in faults ? (
            <ErrorNotice title="Fault posture" message={faults.error} />
          ) : (
            <dl style={{ fontSize: 13, margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px' }}>
              <dt>Deployment</dt>
              <dd style={{ margin: 0 }}>{faults.ok.production ? 'production' : 'non-production'}</dd>
              <dt>Armed</dt>
              <dd style={{ margin: 0 }}>
                <Badge tone={faults.ok.enabled ? 'warning' : 'neutral'}>
                  {faults.ok.enabled ? 'YES — tests only' : 'no'}
                </Badge>
              </dd>
              <dt>Active points</dt>
              <dd style={{ margin: 0 }}>
                {faults.ok.activePoints.length > 0 ? faults.ok.activePoints.join(', ') : 'none'}
              </dd>
            </dl>
          )}
        </Card>
      </div>
    </div>
  );
}
```

FILE: apps/admin-web/src/app/(console)/slo/slo-controls.tsx

```tsx
'use client';

import { useState, useTransition, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { ApiError } from '@/lib/api-error';
import { apiClient } from '@/lib/api-client';
import { theme } from '@/lib/theme';

/**
 * The client-side controls of the SLO console. Their complete power, stated
 * so nobody has to read the API to know what a click can do:
 *
 * - EVALUATE ALL / EVALUATE NOW re-runs the measurement. They append rows to
 *   the evidence log and may fold burn alerts; they change no trading state.
 * - FLUSH EXPORTS runs one tick of the OTLP exporter early. It changes WHEN
 *   evidence leaves the process, never WHAT it says, and against a dead
 *   collector it fails exactly once and reports it, same as the loop.
 * - PUBLISH VERSION appends a NEW definition version. Old versions stay
 *   queryable forever; publishing the identical definition is a no-op with
 *   no phantom version; the action is audited with before/after fields. The
 *   objective is typed as a STRING ("99.5") end to end - floats are refused
 *   by the API on purpose because a promise that has been through IEEE-754
 *   is not the promise anyone configured.
 *
 * There is deliberately NO control here for arming or disarming fault
 * injection, editing a stored version, deleting evidence, or pruning
 * history: the first is environment-only and the rest do not exist as
 * routes at all. No optimistic states on any control - the panel shows what
 * the server said, after the server said it.
 */

const buttonStyle: CSSProperties = {
  fontSize: 13,
  padding: '6px 12px',
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  cursor: 'pointer',
  background: 'transparent',
  color: 'inherit',
};

const inputStyle: CSSProperties = {
  fontSize: 13,
  padding: '6px 8px',
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  background: 'transparent',
  color: 'inherit',
  width: '100%',
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--wlct-color-text-muted)',
  display: 'block',
  marginBottom: 2,
};

function messageFrom(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return (error as Error).message || 'The request could not be completed.';
}

interface EvaluateResult {
  evaluated: number;
  alertingSloIds: string[];
  skipped?: Array<{ sloId: string; error: string }>;
}

function postAndRefresh<T>(path: string, body?: unknown): Promise<T> {
  return apiClient.post<T>(path, body);
}

export function EvaluateAllButton(): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (): void => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const out = await postAndRefresh<EvaluateResult>('/operational/slos/evaluate-all');
        setResult(
          `evaluated ${String(out.evaluated)};` +
            (out.alertingSloIds.length > 0 ? ` paging: ${out.alertingSloIds.join(', ')}` : ' nothing paging') +
            (out.skipped && out.skipped.length > 0 ? `; skipped: ${out.skipped.map((s) => s.sloId).join(', ')}` : ''),
        );
        router.refresh();
      } catch (caught) {
        setError(messageFrom(caught));
      }
    });
  };

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {result !== null && <span style={{ fontSize: 12 }}>{result}</span>}
      {error !== null && (
        <span style={{ fontSize: 12, color: 'var(--wlct-color-danger)' }}>{error}</span>
      )}
      <button type="button" style={buttonStyle} onClick={run} disabled={pending}>
        {pending ? 'Evaluating…' : 'Evaluate all now'}
      </button>
    </span>
  );
}

export function RunNowButton({ sloId }: { sloId: string }): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = (): void => {
    setMessage(null);
    startTransition(async () => {
      try {
        const out = await postAndRefresh<EvaluateResult>(
          `/operational/slos/${encodeURIComponent(sloId)}/evaluate`,
        );
        setMessage(
          out.evaluated === 0
            ? 'skipped (disabled?)'
            : out.alertingSloIds.length > 0
              ? 'evaluated: paging'
              : 'evaluated',
        );
        router.refresh();
      } catch (caught) {
        setMessage(messageFrom(caught));
      }
    });
  };

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {message !== null && <span style={{ fontSize: 12 }}>{message}</span>}
      <button type="button" style={buttonStyle} onClick={run} disabled={pending}>
        {pending ? '…' : 'Evaluate now'}
      </button>
    </span>
  );
}

export function FlushExportButton(): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = (): void => {
    setMessage(null);
    startTransition(async () => {
      try {
        const out = await postAndRefresh<{ exported: number; outcome: string }>(
          '/operational/tracing/flush',
        );
        setMessage(`exported ${String(out.exported)} · ${out.outcome}`);
        router.refresh();
      } catch (caught) {
        setMessage(messageFrom(caught));
      }
    });
  };

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      {message !== null && <span style={{ fontSize: 12 }}>{message}</span>}
      <button type="button" style={buttonStyle} onClick={run} disabled={pending}>
        {pending ? 'Flushing…' : 'Run export tick'}
      </button>
    </span>
  );
}

interface DefinitionLike {
  sloId: string;
  version: number;
  service: string;
  owner: string;
  description: string;
  indicator: string;
  objective: string;
  windowMinutes: number;
  shortWindowMinutes: number;
  goodEvent: string;
  badEvent: string;
  warningBurnPpm: number;
  criticalBurnPpm: number;
  maxAgeMicros: string | null;
  latencyThresholdMicros: string | null;
  enabled: boolean;
}

const FRESHNESS_INDICATORS = new Set([
  'market_data_freshness',
  'risk_state_freshness',
  'queue_freshness',
  'reconciliation_freshness',
]);

const OBJECTIVE_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

export function SloConfigForm({ definition }: { definition: DefinitionLike }): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [objective, setObjective] = useState(definition.objective);
  const [windowMinutes, setWindowMinutes] = useState(String(definition.windowMinutes));
  const [shortWindowMinutes, setShortWindowMinutes] = useState(String(definition.shortWindowMinutes));
  const [owner, setOwner] = useState(definition.owner);
  const [description, setDescription] = useState(definition.description);
  const [goodEvent, setGoodEvent] = useState(definition.goodEvent);
  const [badEvent, setBadEvent] = useState(definition.badEvent);
  const [warningBurnPpm, setWarningBurnPpm] = useState(String(definition.warningBurnPpm));
  const [criticalBurnPpm, setCriticalBurnPpm] = useState(String(definition.criticalBurnPpm));
  const [maxAgeMicros, setMaxAgeMicros] = useState(definition.maxAgeMicros ?? '');
  const [latencyThresholdMicros, setLatencyThresholdMicros] = useState(
    definition.latencyThresholdMicros ?? '',
  );
  const [enabled, setEnabled] = useState(definition.enabled);

  const fresh = FRESHNESS_INDICATORS.has(definition.indicator);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    setNote(null);

    // Client-side mirrors of the server rules, to stop obvious fumbles
    // before a round trip. The server remains the authority; nothing here
    // is trusted past this form.
    if (!OBJECTIVE_RE.test(objective.trim())) {
      setError('Objective must be a decimal string with at most 4 fraction digits (e.g. "99.5").');
      return;
    }
    const body: Record<string, unknown> = {
      objective: objective.trim(),
      windowMinutes: Number(windowMinutes),
      shortWindowMinutes: Number(shortWindowMinutes),
      owner: owner.trim(),
      description: description.trim(),
      goodEvent: goodEvent.trim(),
      badEvent: badEvent.trim(),
      warningBurnPpm: Number(warningBurnPpm),
      criticalBurnPpm: Number(criticalBurnPpm),
      enabled,
    };
    if (fresh && maxAgeMicros.trim() !== '') {
      body.maxAgeMicros = maxAgeMicros.trim();
    }
    if (definition.indicator === 'latency_threshold_compliance' && latencyThresholdMicros.trim() !== '') {
      body.latencyThresholdMicros = latencyThresholdMicros.trim();
    }
    if (fresh && maxAgeMicros.trim() === '') {
      setError('This freshness objective requires an age budget (maxAgeMicros).');
      return;
    }

    startTransition(async () => {
      try {
        // publishConfig answers with the full status view - the version and
        // checksum live on its `definition`. A byte-identical publish is a
        // no-op answered with the CURRENT status, so the note says
        // "at version" rather than claiming a bump that did not happen.
        const out = await postAndRefresh<{ definition: { version: number; checksum: string } }>(
          `/operational/slos/${encodeURIComponent(definition.sloId)}/config`,
          body,
        );
        const bumped = out.definition.version > definition.version;
        setNote(
          `${bumped ? 'Published' : 'No-op (identical definition), still at'} v${String(
            out.definition.version,
          )} · checksum ${out.definition.checksum.slice(0, 12)}…`,
        );
        setOpen(false);
        router.refresh();
      } catch (caught) {
        setError(messageFrom(caught));
      }
    });
  };

  if (!open) {
    return (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        {note !== null && <span style={{ fontSize: 12 }}>{note}</span>}
        {error !== null && (
          <span style={{ fontSize: 12, color: 'var(--wlct-color-danger)' }}>{error}</span>
        )}
        <button type="button" style={buttonStyle} onClick={() => setOpen(true)}>
          Publish version
        </button>
      </span>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{
        marginTop: theme.space(2),
        padding: theme.space(3),
        border: `1px solid ${theme.color.border}`,
        borderRadius: theme.radius.md,
        display: 'grid',
        gap: theme.space(2),
        minWidth: 320,
      }}
    >
      <p style={{ fontSize: 12, margin: 0, color: 'var(--wlct-color-text-muted)' }}>
        Appends v{String(definition.version + 1)} for <strong>{definition.sloId}</strong>. This
        cannot rewrite history, only extend it. The API may answer with the SAME version if the
        definition is byte-identical (no phantom versions).
      </p>
      <label>
        <span style={labelStyle}>Objective (percent string)</span>
        <input style={inputStyle} value={objective} onChange={(e) => setObjective(e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label>
          <span style={labelStyle}>Window (minutes, 5–10080)</span>
          <input style={inputStyle} inputMode="numeric" value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)} />
        </label>
        <label>
          <span style={labelStyle}>Short window (minutes)</span>
          <input style={inputStyle} inputMode="numeric" value={shortWindowMinutes} onChange={(e) => setShortWindowMinutes(e.target.value)} />
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label>
          <span style={labelStyle}>Warning burn (ppm)</span>
          <input style={inputStyle} inputMode="numeric" value={warningBurnPpm} onChange={(e) => setWarningBurnPpm(e.target.value)} />
        </label>
        <label>
          <span style={labelStyle}>Critical burn (ppm)</span>
          <input style={inputStyle} inputMode="numeric" value={criticalBurnPpm} onChange={(e) => setCriticalBurnPpm(e.target.value)} />
        </label>
      </div>
      <label>
        <span style={labelStyle}>Owner</span>
        <input style={inputStyle} value={owner} onChange={(e) => setOwner(e.target.value)} />
      </label>
      <label>
        <span style={labelStyle}>Description</span>
        <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label>
          <span style={labelStyle}>Good event (counting rule, in words)</span>
          <input style={inputStyle} value={goodEvent} onChange={(e) => setGoodEvent(e.target.value)} />
        </label>
        <label>
          <span style={labelStyle}>Bad event (counting rule, in words)</span>
          <input style={inputStyle} value={badEvent} onChange={(e) => setBadEvent(e.target.value)} />
        </label>
      </div>
      {fresh && (
        <label>
          <span style={labelStyle}>Max age (microseconds, required for freshness)</span>
          <input style={inputStyle} inputMode="numeric" value={maxAgeMicros} onChange={(e) => setMaxAgeMicros(e.target.value)} />
        </label>
      )}
      {definition.indicator === 'latency_threshold_compliance' && (
        <label>
          <span style={labelStyle}>Latency threshold (microseconds)</span>
          <input
            style={inputStyle}
            inputMode="numeric"
            value={latencyThresholdMicros}
            onChange={(e) => setLatencyThresholdMicros(e.target.value)}
          />
        </label>
      )}
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span style={{ fontSize: 13 }}>Evaluation enabled</span>
      </label>
      {error !== null && (
        <p style={{ fontSize: 12, color: 'var(--wlct-color-danger)', margin: 0 }}>{error}</p>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={buttonStyle} onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
        <button type="submit" style={buttonStyle} disabled={pending}>
          {pending ? 'Publishing…' : 'Publish version'}
        </button>
      </div>
    </form>
  );
}
```

FILE: apps/admin-web/src/app/(console)/strategies/page.tsx

```tsx
import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, formatRelative, titleCase } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { theme, toneForStatus } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Strategies' };

/**
 * Read-mostly strategy console.
 *
 * Deliberately read-only in this increment. Starting a strategy is a POST that
 * requires a written reason, a runnable published version, and - under a
 * live-armed deployment - a typed confirmation phrase. A one-click toggle on a
 * dashboard is the wrong shape for that, and shipping the toggle before the
 * confirmation flow is how a "quick test" becomes a running strategy.
 *
 * Every panel is fetched independently: a failure degrades one panel rather
 * than the page, because the moment an operator most needs this screen is the
 * moment something is already broken.
 */

interface StrategyMetrics {
  instances: {
    total: number;
    enabled: number;
    running: number;
    quarantined: number;
    unhealthy: number;
  };
  incidents: { open: number; critical: number; warning: number; info: number };
  runs: { active: number; failedLast24h: number };
  backtests: {
    queued: number;
    running: number;
    completedLast24h: number;
    failedLast24h: number;
  };
  paperSessions: { running: number; stoppedLast24h: number };
  configuration: {
    strategyEngineEnabled: boolean;
    paperTradingEnabled: boolean;
    backtestEnabled: boolean;
    maxInstances: number;
    eventQueueSize: number;
    maxProcessingLatencyMs: number;
    signalMaxAgeMs: number;
    signalDedupTtlSeconds: number;
    tradingMode: string;
    liveExecutionReachable: boolean;
  };
  latencyNote: string;
  disclaimer: string;
}

interface StrategyInstance {
  id: string;
  name: string;
  kind: string;
  version: string;
  status: string;
  enabled: boolean;
  health: string;
  venue: string;
  symbols: string[];
  consecutiveErrors: number;
  lastHeartbeatAt: string | null;
  lastErrorCode: string | null;
  quarantinedAt: string | null;
}

interface BacktestRun {
  id: string;
  runIdentifier: string;
  status: string;
  strategyKey: string;
  strategyVersion: string;
  symbol: string;
  result: {
    netPnl: string | null;
    totalTrades: number;
    winRate: string | null;
    sharpeRatio: string | null;
    maxDrawdown: string | null;
    hasSufficientObservations: boolean;
  };
  isReproducible: boolean;
  queuedAt: string;
  completedAt: string | null;
}

interface PaperSession {
  id: string;
  sessionIdentifier: string;
  status: string;
  strategyKey: string;
  symbol: string;
  currentEquity: string | null;
  realisedPnl: string;
  simulatedOrders: number;
  simulatedFills: number;
  riskRejections: number;
  startedAt: string;
}

interface StrategyIncident {
  id: string;
  incidentType: string;
  severity: string;
  symbol: string | null;
  errorCode: string | null;
  summary: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface Paginated<T> {
  items: T[];
  pagination: { totalItems: number };
}

interface ConsoleData {
  metrics: StrategyMetrics | null;
  instances: StrategyInstance[];
  backtests: BacktestRun[];
  sessions: PaperSession[];
  incidents: StrategyIncident[];
  failures: string[];
}

async function loadConsole(): Promise<ConsoleData> {
  const failures: string[] = [];

  const describe = (label: string) => (error: unknown) => {
    failures.push(error instanceof ApiError ? `${label}: ${error.message}` : `${label} unavailable`);
    return null;
  };

  const [metrics, instances, backtests, sessions, incidents] = await Promise.all([
    serverFetch<StrategyMetrics>('/strategies/metrics').catch(describe('Metrics')),
    serverFetch<Paginated<StrategyInstance>>('/strategies/instances', {
      searchParams: { page: 1, limit: 20 },
    }).catch(describe('Instances')),
    serverFetch<Paginated<BacktestRun>>('/strategies/backtests', {
      searchParams: { page: 1, limit: 10 },
    }).catch(describe('Backtests')),
    serverFetch<Paginated<PaperSession>>('/strategies/paper-sessions', {
      searchParams: { page: 1, limit: 10 },
    }).catch(describe('Paper sessions')),
    serverFetch<Paginated<StrategyIncident>>('/strategies/incidents', {
      searchParams: { page: 1, limit: 10, unresolvedOnly: true },
    }).catch(describe('Incidents')),
  ]);

  return {
    metrics,
    instances: instances?.items ?? [],
    backtests: backtests?.items ?? [],
    sessions: sessions?.items ?? [],
    incidents: incidents?.items ?? [],
    failures,
  };
}

function healthTone(health: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (health) {
    case 'HEALTHY':
      return 'success';
    case 'DEGRADED':
      return 'warning';
    case 'UNHEALTHY':
    case 'QUARANTINED':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** A metric that was withheld reads as "insufficient data", never as zero. */
function metricOrWithheld(value: string | null, sufficient: boolean): string {
  if (value !== null) {
    return value;
  }
  return sufficient ? '—' : 'insufficient data';
}

export default async function StrategiesPage(): Promise<JSX.Element> {
  const { metrics, instances, backtests, sessions, incidents, failures } = await loadConsole();
  const config = metrics?.configuration;

  return (
    <>
      <PageHeader
        title="Strategies"
        description="Strategy instances, simulated results and incidents for this organisation."
      />

      {failures.length > 0 && (
        <div style={{ marginTop: theme.space(5) }}>
          <ErrorNotice title="Some panels could not be loaded" message={failures.join(' · ')} />
        </div>
      )}

      {/* The single most misread fact on this page, stated before anything
          else: whether a signal from these strategies could become a real
          order in this deployment. */}
      <div style={{ marginTop: theme.space(5) }}>
        <Card
          title="Execution boundary"
          description="What the strategy layer is currently permitted to reach."
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.space(2) }}>
            <Badge tone={config?.strategyEngineEnabled ? 'success' : 'neutral'}>
              Engine {config?.strategyEngineEnabled ? 'enabled' : 'disabled'}
            </Badge>
            <Badge tone={config?.paperTradingEnabled ? 'info' : 'neutral'}>
              Paper trading {config?.paperTradingEnabled ? 'enabled' : 'disabled'}
            </Badge>
            <Badge tone={config?.backtestEnabled ? 'info' : 'neutral'}>
              Backtesting {config?.backtestEnabled ? 'enabled' : 'disabled'}
            </Badge>
            <Badge tone={config?.liveExecutionReachable ? 'danger' : 'success'}>
              {config?.liveExecutionReachable
                ? 'LIVE EXECUTION REACHABLE'
                : 'Live execution not reachable'}
            </Badge>
            <Badge tone="neutral">Trading mode {config?.tradingMode ?? 'unknown'}</Badge>
          </div>
          <p style={{ color: theme.color.textMuted, fontSize: 13, marginTop: theme.space(4) }}>
            Enabling a strategy makes it emit signals. Whether a signal becomes an order is decided
            afterwards by the risk engine and the execution gates, and no strategy setting changes
            that.
          </p>
          {metrics && (
            <p style={{ color: theme.color.textMuted, fontSize: 13, margin: 0 }}>
              {metrics.latencyNote}
            </p>
          )}
        </Card>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: theme.space(4),
          marginTop: theme.space(6),
        }}
      >
        <StatTile
          label="Instances"
          value={metrics?.instances.total ?? '—'}
          hint={`${metrics?.instances.enabled ?? 0} enabled · limit ${config?.maxInstances ?? '—'}`}
        />
        <StatTile
          label="Running"
          value={metrics?.instances.running ?? '—'}
          hint={`${metrics?.runs.failedLast24h ?? 0} runs failed in 24h`}
        />
        <StatTile
          label="Unhealthy"
          value={(metrics?.instances.unhealthy ?? 0) + (metrics?.instances.quarantined ?? 0)}
          hint={`${metrics?.instances.quarantined ?? 0} quarantined`}
        />
        <StatTile
          label="Open incidents"
          value={metrics?.incidents.open ?? '—'}
          hint={`${metrics?.incidents.critical ?? 0} critical`}
        />
        <StatTile
          label="Backtests"
          value={metrics?.backtests.completedLast24h ?? '—'}
          hint={`${metrics?.backtests.queued ?? 0} queued · ${metrics?.backtests.running ?? 0} running`}
        />
        <StatTile
          label="Paper sessions"
          value={metrics?.paperSessions.running ?? '—'}
          hint={`${metrics?.paperSessions.stoppedLast24h ?? 0} stopped in 24h`}
        />
      </div>

      <div style={{ display: 'grid', gap: theme.space(5), marginTop: theme.space(6) }}>
        <Card
          title="Instances"
          description="Health is reported separately from enabled: an instance can be both enabled and unhealthy."
        >
          <DataTable
            rows={instances}
            rowKey={(row) => row.id}
            emptyTitle="No strategy instances"
            emptyDescription="Instances are created against a published strategy version."
            columns={[
              {
                key: 'name',
                header: 'Name',
                render: (row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.kind}@{row.version}
                    </div>
                  </div>
                ),
              },
              {
                key: 'market',
                header: 'Market',
                render: (row) => (
                  <div>
                    <div>{row.venue}</div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.symbols.join(', ')}
                    </div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
                    <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>
                    <Badge tone={healthTone(row.health)}>{titleCase(row.health)}</Badge>
                  </div>
                ),
              },
              {
                key: 'errors',
                header: 'Errors',
                align: 'right',
                render: (row) => (
                  <div>
                    <div>{row.consecutiveErrors}</div>
                    {row.lastErrorCode && (
                      <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                        {row.lastErrorCode}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'heartbeat',
                header: 'Last heartbeat',
                render: (row) =>
                  row.lastHeartbeatAt ? formatRelative(row.lastHeartbeatAt) : 'never reported',
              },
            ]}
          />
        </Card>

        <Card
          title="Recent backtests"
          description="SIMULATED. Backtest performance is not indicative of future performance."
        >
          <DataTable
            rows={backtests}
            rowKey={(row) => row.id}
            emptyTitle="No backtests yet"
            emptyDescription="A backtest replays a stored dataset. It reaches no venue."
            columns={[
              {
                key: 'run',
                header: 'Run',
                render: (row) => (
                  <div>
                    <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{row.runIdentifier}</div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.strategyKey}@{row.strategyVersion} · {row.symbol}
                    </div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
                    <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>
                    {!row.isReproducible && <Badge tone="warning">No checksum</Badge>}
                  </div>
                ),
              },
              {
                key: 'pnl',
                header: 'Net PnL',
                align: 'right',
                render: (row) => row.result.netPnl ?? '—',
              },
              {
                key: 'trades',
                header: 'Trades',
                align: 'right',
                render: (row) => row.result.totalTrades,
              },
              {
                key: 'sharpe',
                header: 'Sharpe',
                align: 'right',
                render: (row) =>
                  metricOrWithheld(row.result.sharpeRatio, row.result.hasSufficientObservations),
              },
              {
                key: 'completed',
                header: 'Completed',
                render: (row) => (row.completedAt ? formatDateTime(row.completedAt) : '—'),
              },
            ]}
          />
        </Card>

        <Card
          title="Paper sessions"
          description="SIMULATED FILLS against real prices. Paper performance is not indicative of live performance."
        >
          <DataTable
            rows={sessions}
            rowKey={(row) => row.id}
            emptyTitle="No paper sessions"
            emptyDescription="A paper session refuses any adapter that is not marked simulated."
            columns={[
              {
                key: 'session',
                header: 'Session',
                render: (row) => (
                  <div>
                    <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {row.sessionIdentifier}
                    </div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.strategyKey} · {row.symbol}
                    </div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>,
              },
              {
                key: 'equity',
                header: 'Equity',
                align: 'right',
                render: (row) => row.currentEquity ?? '—',
              },
              {
                key: 'realised',
                header: 'Realised',
                align: 'right',
                render: (row) => row.realisedPnl,
              },
              {
                key: 'fills',
                header: 'Orders / fills',
                align: 'right',
                render: (row) => `${row.simulatedOrders} / ${row.simulatedFills}`,
              },
              {
                key: 'rejections',
                header: 'Risk rejections',
                align: 'right',
                render: (row) => row.riskRejections,
              },
              {
                key: 'started',
                header: 'Started',
                render: (row) => formatRelative(row.startedAt),
              },
            ]}
          />
        </Card>

        <Card
          title="Open incidents"
          description="Raised by the strategy worker. A rejected signal on its own is the system working and produces nothing here."
        >
          <DataTable
            rows={incidents}
            rowKey={(row) => row.id}
            emptyTitle="No open incidents"
            columns={[
              {
                key: 'severity',
                header: 'Severity',
                render: (row) => <Badge tone={toneForStatus(row.severity)}>{row.severity}</Badge>,
              },
              { key: 'type', header: 'Type', render: (row) => titleCase(row.incidentType) },
              {
                key: 'summary',
                header: 'Summary',
                render: (row) => (
                  <div>
                    <div>{row.summary}</div>
                    {row.errorCode && (
                      <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                        {row.errorCode}
                        {row.symbol ? ` · ${row.symbol}` : ''}
                      </div>
                    )}
                  </div>
                ),
              },
              { key: 'raised', header: 'Raised', render: (row) => formatRelative(row.createdAt) },
            ]}
          />
        </Card>

        <Card title="What these numbers are not">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.9 }}>
            <li>Backtest performance is not indicative of future performance.</li>
            <li>Paper performance is not indicative of live performance.</li>
            <li>Simulation does not guarantee real execution quality.</li>
            <li>
              The simulator ignores queue position, market impact and venue rejections, so it
              systematically flatters a strategy that would in reality have waited or moved the
              price.
            </li>
            <li>
              Risk-adjusted figures are withheld rather than estimated when there were too few
              observations. &quot;Insufficient data&quot; is not zero.
            </li>
            <li>No strategy shipped with this platform carries a profitability claim.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
```

FILE: apps/admin-web/src/app/(console)/subscription/page.tsx

```tsx
import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, type Column } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatBasisPoints, formatDateTime, formatLimit, formatMoney, titleCase } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { theme, toneForStatus } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Subscription' };

interface PlanLimits {
  maxUsers: number | null;
  maxTraders: number | null;
  maxFollowersPerTrader: number | null;
  maxExchangeAccountsPerUser: number | null;
  maxCopySubscriptionsPerFollower: number | null;
  maxApiRequestsPerMinute: number | null;
  websocketConnections: number | null;
  customDomain: boolean;
  whiteLabelMobileApp: boolean;
  prioritySupport: boolean;
}

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  audience: string;
  price: string;
  currency: string;
  interval: string;
  trialDays: number;
  platformFeeBps: number;
  performanceFeeBps: number;
  limits: PlanLimits;
  features: string[];
  isActive: boolean;
}

interface Subscription {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  seatsPurchased: number;
  plan?: Plan;
}

interface Paginated<T> {
  items: T[];
  pagination: { totalItems: number };
}

export default async function SubscriptionPage(): Promise<JSX.Element> {
  let subscription: Subscription | null = null;
  let limits: PlanLimits | null = null;
  let plans: Plan[] = [];
  let error: string | null = null;

  try {
    subscription = await serverFetch<Subscription | null>('/billing/subscription');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'The subscription could not be loaded.';
  }

  try {
    limits = await serverFetch<PlanLimits | null>('/billing/subscription/limits');
  } catch {
    limits = null;
  }

  try {
    const catalogue = await serverFetch<Paginated<Plan>>('/billing/plans', {
      searchParams: { page: 1, limit: 25 },
    });
    plans = catalogue.items;
  } catch {
    plans = [];
  }

  const planColumns: Array<Column<Plan>> = [
    {
      key: 'plan',
      header: 'Plan',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.name}</div>
          <div style={{ fontSize: 12, color: theme.color.textMuted }}>
            <code>{row.code}</code> · {row.audience}
          </div>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      render: (row) => (
        <div>
          <div>{formatMoney(row.price, row.currency)}</div>
          <div style={{ fontSize: 12, color: theme.color.textMuted }}>per {row.interval.toLowerCase()}</div>
        </div>
      ),
    },
    { key: 'trial', header: 'Trial', align: 'right', render: (row) => `${row.trialDays} days` },
    {
      key: 'fees',
      header: 'Fees',
      align: 'right',
      render: (row) => (
        <div style={{ fontSize: 13 }}>
          <div>Platform {formatBasisPoints(row.platformFeeBps)}</div>
          <div style={{ color: theme.color.textMuted }}>
            Performance {formatBasisPoints(row.performanceFeeBps)}
          </div>
        </div>
      ),
    },
    { key: 'users', header: 'Users', align: 'right', render: (row) => formatLimit(row.limits.maxUsers) },
    { key: 'traders', header: 'Traders', align: 'right', render: (row) => formatLimit(row.limits.maxTraders) },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (row.isActive ? <Badge tone="success">Active</Badge> : <Badge>Archived</Badge>),
    },
  ];

  return (
    <>
      <PageHeader
        title="Subscription"
        description="The subscription is the single source of truth for entitlements. Seat and feature limits are enforced by the API, not by the console."
      />

      {error && <ErrorNotice title="Unable to load the subscription" message={error} />}

      <div style={{ display: 'grid', gap: theme.space(5), marginTop: error ? theme.space(5) : 0 }}>
        <Card title="Current subscription">
          {!subscription ? (
            <p style={{ margin: 0, fontSize: 14, color: theme.color.textMuted }}>
              No subscription is assigned to this organisation.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: theme.space(4) }}>
              <div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>PLAN</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>
                  {subscription.plan?.name ?? '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>STATUS</div>
                <div style={{ marginTop: 6 }}>
                  <Badge tone={toneForStatus(subscription.status)}>{titleCase(subscription.status)}</Badge>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>CURRENT PERIOD</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  {formatDateTime(subscription.currentPeriodStart)} →{' '}
                  {formatDateTime(subscription.currentPeriodEnd)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>SEATS</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>
                  {subscription.seatsPurchased}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>RENEWAL</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  {subscription.cancelAtPeriodEnd ? 'Cancels at period end' : 'Renews automatically'}
                </div>
              </div>
            </div>
          )}
        </Card>

        {limits && (
          <Card title="Effective entitlements" description="Resolved from the active plan.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: theme.space(4), fontSize: 14 }}>
              <div>Users: {formatLimit(limits.maxUsers)}</div>
              <div>Traders: {formatLimit(limits.maxTraders)}</div>
              <div>Followers per trader: {formatLimit(limits.maxFollowersPerTrader)}</div>
              <div>Exchange accounts per user: {formatLimit(limits.maxExchangeAccountsPerUser)}</div>
              <div>Copy subscriptions per follower: {formatLimit(limits.maxCopySubscriptionsPerFollower)}</div>
              <div>API requests / minute: {formatLimit(limits.maxApiRequestsPerMinute)}</div>
              <div>Websocket connections: {formatLimit(limits.websocketConnections)}</div>
              <div>Custom domain: {limits.customDomain ? 'Yes' : 'No'}</div>
              <div>White-label mobile app: {limits.whiteLabelMobileApp ? 'Yes' : 'No'}</div>
              <div>Priority support: {limits.prioritySupport ? 'Yes' : 'No'}</div>
            </div>
          </Card>
        )}

        <Card
          title="Plan catalogue"
          description="Platform plans plus any plans this organisation owns. No card data is held by the platform; payment provider integration lands in a later part."
        >
          <DataTable columns={planColumns} rows={plans} rowKey={(row) => row.id} emptyTitle="No plans available" />
        </Card>
      </div>
    </>
  );
}
```

FILE: apps/admin-web/src/app/(console)/tenants/page.tsx

```tsx
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
```

FILE: apps/admin-web/src/app/(console)/users/page.tsx

```tsx
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
```

FILE: apps/admin-web/src/app/api/auth/login/route.ts

```typescript
import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/lib/api-error';
import { serverFetch } from '@/lib/server-api';
import { persistSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

interface SessionPayload {
  tokens: TokenPair;
  user: { id: string; email: string; isPlatformUser: boolean; permissions: string[] };
  sessionId: string;
}

interface ChallengePayload {
  twoFactorRequired: true;
  challengeToken: string;
  expiresIn: number;
  methods: string[];
}

type LoginResult = SessionPayload | ChallengePayload;

/**
 * Exchanges credentials for a session cookie.
 *
 * The token pair is written straight into httpOnly cookies and never returned
 * to the browser. The response body only says what should happen next.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'A JSON body is required.' } },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check the highlighted fields.',
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  // A stable per-browser device id lets the API bind refresh tokens to this
  // console instance and show it in the user's session list.
  const deviceId = `web-${randomUUID()}`;

  try {
    const result = await serverFetch<LoginResult>('/auth/login', {
      method: 'POST',
      authenticated: false,
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
        deviceId,
        deviceName: 'Admin console',
        platform: 'web',
      },
    });

    if ('twoFactorRequired' in result) {
      // The challenge token is short-lived and useless without the OTP, but it
      // still goes into an httpOnly cookie rather than the response body.
      const response = NextResponse.json({
        success: true,
        data: { twoFactorRequired: true, methods: result.methods },
      });

      response.cookies.set('wlct_2fa', result.challengeToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: result.expiresIn,
      });
      response.cookies.set('wlct_2fa_did', deviceId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: result.expiresIn,
      });

      return response;
    }

    persistSession(result.tokens, deviceId, randomUUID());

    return NextResponse.json({
      success: true,
      data: { twoFactorRequired: false, redirectTo: '/dashboard' },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        {
          success: false,
          error: { code: error.code, message: error.message, details: error.details },
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Sign-in failed. Please try again.' },
      },
      { status: 500 },
    );
  }
}
```

FILE: apps/admin-web/src/app/api/auth/logout/route.ts

```typescript
import { NextResponse } from 'next/server';

import { serverFetch } from '@/lib/server-api';
import { clearSession, getAccessToken, getCsrfToken } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ends the session.
 *
 * Cookies are cleared regardless of what the API says: a user who clicks sign
 * out must end up signed out locally even if the backend call fails.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const submitted = request.headers.get('x-csrf-token');
  const expected = getCsrfToken();

  if (!expected || submitted !== expected) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Invalid CSRF token.' } },
      { status: 403 },
    );
  }

  if (getAccessToken()) {
    try {
      await serverFetch('/auth/logout', { method: 'POST', body: { allDevices: false } });
    } catch {
      // Intentionally swallowed: local sign-out must still happen.
    }
  }

  clearSession();

  return NextResponse.json({ success: true, data: { loggedOut: true } });
}
```

FILE: apps/admin-web/src/app/api/auth/refresh/route.ts

```typescript
import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { ApiError } from '@/lib/api-error';
import { serverFetch } from '@/lib/server-api';
import { clearSession, getCsrfToken, getDeviceId, getRefreshToken, persistSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SessionPayload {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number };
}

/**
 * Rotates the session.
 *
 * The API revokes the whole token family if a consumed refresh token is
 * replayed, so a failure here means the session is gone: clear the cookies
 * rather than leaving a half-dead session in the browser.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const submitted = request.headers.get('x-csrf-token');
  const expected = getCsrfToken();

  if (!expected || submitted !== expected) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Invalid CSRF token.' } },
      { status: 403 },
    );
  }

  const refreshToken = getRefreshToken();
  const deviceId = getDeviceId();

  if (!refreshToken || !deviceId) {
    clearSession();
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'No active session.' } },
      { status: 401 },
    );
  }

  try {
    const result = await serverFetch<SessionPayload>('/auth/refresh', {
      method: 'POST',
      authenticated: false,
      body: { refreshToken, deviceId },
    });

    persistSession(result.tokens, deviceId, randomUUID());

    return NextResponse.json({ success: true, data: { refreshed: true } });
  } catch (error) {
    clearSession();

    const status = error instanceof ApiError ? error.status : 401;

    return NextResponse.json(
      {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Your session has expired. Please sign in again.' },
      },
      { status: status === 401 || status === 403 ? 401 : status },
    );
  }
}
```

FILE: apps/admin-web/src/app/api/auth/two-factor/route.ts

```typescript
import { randomUUID } from 'node:crypto';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/lib/api-error';
import { serverFetch } from '@/lib/server-api';
import { persistSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  code: z.string().min(6).max(32),
  method: z.enum(['TOTP', 'RECOVERY_CODE']).default('TOTP'),
});

interface SessionPayload {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number };
  sessionId: string;
}

/** Completes a two-factor challenge started by /api/auth/login. */
export async function POST(request: Request): Promise<NextResponse> {
  const store = cookies();
  const challengeToken = store.get('wlct_2fa')?.value;
  const deviceId = store.get('wlct_2fa_did')?.value;

  if (!challengeToken || !deviceId) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'The challenge expired. Please sign in again.' },
      },
      { status: 401 },
    );
  }

  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'A JSON body is required.' } },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Enter the six-digit code from your app.' },
      },
      { status: 400 },
    );
  }

  try {
    const result = await serverFetch<SessionPayload>('/auth/two-factor/verify', {
      method: 'POST',
      authenticated: false,
      body: {
        challengeToken,
        code: parsed.data.code,
        method: parsed.data.method,
        deviceId,
      },
    });

    persistSession(result.tokens, deviceId, randomUUID());

    const response = NextResponse.json({ success: true, data: { redirectTo: '/dashboard' } });
    response.cookies.delete('wlct_2fa');
    response.cookies.delete('wlct_2fa_did');
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Verification failed.' },
      },
      { status: 500 },
    );
  }
}
```

FILE: apps/admin-web/src/app/api/proxy/[...path]/route.ts

```typescript
import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { serverEnv, publicEnv } from '@/lib/env';
import { getAccessToken, getCsrfToken } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Same-origin proxy to the platform API.
 *
 * Why a proxy at all: it keeps the bearer token in an httpOnly cookie (so XSS
 * cannot steal a session), removes the need for CORS on the API, and gives the
 * console one enforcement point for CSRF on state-changing verbs.
 *
 * Only paths under the API's versioned namespace are forwarded, and the
 * Authorization header is attached here - never by the browser.
 */
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Response headers that must not be echoed back to the browser. */
const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'set-cookie',
]);

async function handle(request: Request, segments: string[]): Promise<NextResponse> {
  const env = serverEnv();

  if (MUTATING_METHODS.has(request.method)) {
    const submitted = request.headers.get('x-csrf-token');
    const expected = getCsrfToken();

    if (!expected || submitted !== expected) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Invalid CSRF token.' } },
        { status: 403 },
      );
    }
  }

  const token = getAccessToken();

  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'No active session.' } },
      { status: 401 },
    );
  }

  // Path traversal guard: segments come from the URL and must stay simple.
  if (segments.some((segment) => segment.includes('..') || segment.includes('\\'))) {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid path.' } },
      { status: 400 },
    );
  }

  const incoming = new URL(request.url);
  const base = env.API_BASE_URL.replace(/\/+$/, '');
  const target = new URL(`${base}/${publicEnv.apiVersion}/${segments.join('/')}`);
  target.search = incoming.search;

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    'x-tenant-slug': env.ADMIN_TENANT_SLUG,
    'x-request-id': request.headers.get('x-request-id') ?? randomUUID(),
  };

  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers['content-type'] = contentType;
  }

  let upstream: Response;

  try {
    upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await request.arrayBuffer(),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The platform API is unreachable. Please try again shortly.',
        },
      },
      { status: 503 },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

interface RouteContext {
  params: { path: string[] };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  return handle(request, context.params.path);
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  return handle(request, context.params.path);
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  return handle(request, context.params.path);
}

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  return handle(request, context.params.path);
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  return handle(request, context.params.path);
}
```

FILE: apps/admin-web/src/app/error.tsx

```tsx
'use client';

import { useEffect } from 'react';

/**
 * Root error boundary.
 *
 * Renders a generic message: an error digest is safe to show, the underlying
 * message is not, because it can carry internal detail.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('admin-web.render_error', { digest: error.digest });
  }, [error]);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 460 }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ color: 'var(--wlct-color-text-muted)', fontSize: 14 }}>
          The page could not be displayed. The incident has been logged.
        </p>
        {error.digest && (
          <p style={{ color: 'var(--wlct-color-text-muted)', fontSize: 12 }}>
            Reference: <code>{error.digest}</code>
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 16,
            padding: '10px 18px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--wlct-color-primary)',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
```

FILE: apps/admin-web/src/app/layout.tsx

```tsx
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import '@/styles/globals.css';
import { publicEnv } from '@/lib/env';

export const metadata: Metadata = {
  title: {
    default: publicEnv.appName,
    template: `%s · ${publicEnv.appName}`,
  },
  description: 'Administration console for the white-label copy-trading platform.',
  // The console must never be indexed: it is an internal operator surface.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b1020',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

FILE: apps/admin-web/src/app/login/page.tsx

```tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/login-form';
import { publicEnv } from '@/lib/env';
import { getAccessToken } from '@/lib/session';
import { theme } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage(): JSX.Element {
  if (getAccessToken()) {
    redirect('/dashboard');
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: theme.space(6),
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: theme.color.surface,
          border: `1px solid ${theme.color.border}`,
          borderRadius: theme.radius.lg,
          padding: theme.space(8),
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>{publicEnv.appName}</h1>
        <p style={{ color: theme.color.textMuted, fontSize: 14, marginTop: theme.space(2) }}>
          Sign in with your operator account.
        </p>

        <div style={{ marginTop: theme.space(6) }}>
          <LoginForm />
        </div>

        <p style={{ color: theme.color.textMuted, fontSize: 12, marginTop: theme.space(6) }}>
          Access is logged. Repeated failed attempts temporarily lock the account.
        </p>
      </div>
    </main>
  );
}
```

FILE: apps/admin-web/src/app/not-found.tsx

```tsx
import Link from 'next/link';

export default function NotFound(): JSX.Element {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Page not found</h1>
        <p style={{ color: 'var(--wlct-color-text-muted)', fontSize: 14 }}>
          The page you requested does not exist.
        </p>
        <Link href="/dashboard" style={{ fontSize: 14 }}>
          Back to the overview
        </Link>
      </div>
    </main>
  );
}
```

FILE: apps/admin-web/src/app/page.tsx

```tsx
import { redirect } from 'next/navigation';

import { getAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** The root path is a router: signed-in users land on the overview. */
export default function IndexPage(): never {
  if (getAccessToken()) {
    redirect('/dashboard');
  }

  redirect('/login');
}
```

FILE: apps/admin-web/src/components/login-form.tsx

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { theme } from '@/lib/theme';

interface LoginResponse {
  success: boolean;
  data?: { twoFactorRequired: boolean; redirectTo?: string; methods?: string[] };
  error?: { code: string; message: string; details?: Array<{ field: string; message: string }> };
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: theme.radius.sm,
  border: `1px solid ${theme.color.border}`,
  background: theme.color.bg,
  color: theme.color.text,
  marginTop: 6,
} as const;

const labelStyle = { fontSize: 13, color: theme.color.textMuted, fontWeight: 600 } as const;

/**
 * Sign-in form.
 *
 * Credentials go to this app's own route handler, which performs the API call
 * server-side and sets httpOnly cookies. No token ever reaches this component.
 */
export function LoginForm(): JSX.Element {
  const router = useRouter();

  const [stage, setStage] = useState<'credentials' | 'two-factor'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function submitCredentials(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'same-origin',
      });

      const payload = (await response.json()) as LoginResponse;

      if (!response.ok || !payload.success) {
        setError(payload.error?.message ?? 'Sign-in failed. Please try again.');
        const map: Record<string, string> = {};
        for (const detail of payload.error?.details ?? []) {
          map[detail.field] = detail.message;
        }
        setFieldErrors(map);
        return;
      }

      if (payload.data?.twoFactorRequired) {
        setStage('two-factor');
        setPassword('');
        return;
      }

      router.replace(payload.data?.redirectTo ?? '/dashboard');
      router.refresh();
    } catch {
      setError('Unable to reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitTwoFactor(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/two-factor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, method: useRecoveryCode ? 'RECOVERY_CODE' : 'TOTP' }),
        credentials: 'same-origin',
      });

      const payload = (await response.json()) as LoginResponse;

      if (!response.ok || !payload.success) {
        setError(payload.error?.message ?? 'Verification failed.');
        return;
      }

      router.replace(payload.data?.redirectTo ?? '/dashboard');
      router.refresh();
    } catch {
      setError('Unable to reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const buttonStyle = {
    width: '100%',
    marginTop: theme.space(5),
    padding: '11px 16px',
    borderRadius: theme.radius.sm,
    border: 'none',
    background: theme.color.primary,
    color: theme.color.primaryContrast,
    fontWeight: 600,
    cursor: submitting ? 'not-allowed' : 'pointer',
    opacity: submitting ? 0.7 : 1,
  } as const;

  if (stage === 'two-factor') {
    return (
      <form onSubmit={submitTwoFactor} noValidate>
        <p style={{ color: theme.color.textMuted, fontSize: 14, marginTop: 0 }}>
          {useRecoveryCode
            ? 'Enter one of the recovery codes you saved when you enabled two-factor authentication.'
            : 'Enter the six-digit code from your authenticator app.'}
        </p>

        <label style={labelStyle} htmlFor="code">
          {useRecoveryCode ? 'Recovery code' : 'Authentication code'}
          <input
            id="code"
            name="code"
            style={inputStyle}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code"
            inputMode={useRecoveryCode ? 'text' : 'numeric'}
            required
            minLength={6}
            maxLength={32}
          />
        </label>

        {error && (
          <p role="alert" style={{ color: theme.color.danger, fontSize: 13, marginTop: theme.space(3) }}>
            {error}
          </p>
        )}

        <button type="submit" style={buttonStyle} disabled={submitting}>
          {submitting ? 'Verifying…' : 'Verify and continue'}
        </button>

        <button
          type="button"
          onClick={() => {
            setUseRecoveryCode((current) => !current);
            setCode('');
            setError(null);
          }}
          style={{
            width: '100%',
            marginTop: theme.space(3),
            background: 'transparent',
            border: 'none',
            color: theme.color.primary,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          {useRecoveryCode ? 'Use my authenticator app instead' : 'Use a recovery code instead'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitCredentials} noValidate>
      <label style={labelStyle} htmlFor="email">
        Work email
        <input
          id="email"
          name="email"
          type="email"
          style={inputStyle}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          required
          maxLength={254}
        />
      </label>
      {fieldErrors.email && (
        <p style={{ color: theme.color.danger, fontSize: 12, margin: '6px 0 0' }}>{fieldErrors.email}</p>
      )}

      <div style={{ marginTop: theme.space(4) }}>
        <label style={labelStyle} htmlFor="password">
          Password
          <input
            id="password"
            name="password"
            type="password"
            style={inputStyle}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        {fieldErrors.password && (
          <p style={{ color: theme.color.danger, fontSize: 12, margin: '6px 0 0' }}>
            {fieldErrors.password}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" style={{ color: theme.color.danger, fontSize: 13, marginTop: theme.space(3) }}>
          {error}
        </p>
      )}

      <button type="submit" style={buttonStyle} disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
```

FILE: apps/admin-web/src/components/sidebar.tsx

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { theme } from '@/lib/theme';

export interface NavItem {
  href: string;
  label: string;
  /** Permission required to see the entry. Empty means always visible. */
  permission?: string;
  platformOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/tenants', label: 'Organisations', permission: 'tenant:read', platformOnly: true },
  { href: '/users', label: 'Users', permission: 'user:read' },
  { href: '/roles', label: 'Roles & permissions', permission: 'role:read' },
  { href: '/strategies', label: 'Strategies', permission: 'strategy_instance:read' },
  // Read-only metadata over historical data (Part 7). Visibility is a
  // usability filter, not the access control - the API enforces
  // dataset:read on every route this page consumes.
  { href: '/datasets', label: 'Datasets', permission: 'dataset:read' },
  // Part 8: mirrored risk posture plus the stop/clear ceremony. The
  // permission gates the link; the API gates every call the page makes.
  { href: '/risk', label: 'Risk', permission: 'risk:read' },
  { href: '/observability', label: 'Observability', permission: 'operations:read' },
  // Part 10: error budgets, burn paging, telemetry posture. Read-mostly:
  // its two writes append definition VERSIONS and ask the evaluator to look.
  { href: '/slo', label: 'Service objectives', permission: 'operations:read' },
  { href: '/branding', label: 'Branding', permission: 'tenant:read' },
  { href: '/subscription', label: 'Subscription', permission: 'billing:read' },
  { href: '/audit-logs', label: 'Audit log', permission: 'audit:read' },
  { href: '/settings', label: 'Settings', permission: 'tenant:read' },
];

/**
 * Navigation is filtered by the permissions embedded in the session.
 *
 * This is a usability filter only - hiding a link is not access control. Every
 * route also re-checks authorisation server-side, and the API is the final
 * authority on every request.
 */
export function Sidebar({
  permissions,
  isPlatformUser,
}: {
  permissions: string[];
  isPlatformUser: boolean;
}): JSX.Element {
  const pathname = usePathname();
  const permissionSet = new Set(permissions);

  const visible = NAV_ITEMS.filter((item) => {
    if (item.platformOnly && !isPlatformUser) {
      return false;
    }
    if (!item.permission) {
      return true;
    }
    if (permissionSet.has('*')) {
      return true;
    }

    const [resource] = item.permission.split(':');
    return permissionSet.has(item.permission) || permissionSet.has(`${resource}:*`);
  });

  return (
    <nav
      aria-label="Primary"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: theme.space(3),
      }}
    >
      {visible.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            style={{
              display: 'block',
              padding: '9px 12px',
              borderRadius: theme.radius.sm,
              fontSize: 14,
              fontWeight: active ? 600 : 500,
              color: active ? theme.color.text : theme.color.textMuted,
              background: active ? theme.color.surfaceRaised : 'transparent',
              textDecoration: 'none',
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

FILE: apps/admin-web/src/components/sign-out-button.tsx

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { theme } from '@/lib/theme';

function readCsrfCookie(): string {
  const match = document.cookie.match(/(?:^|;\s*)wlct_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export function SignOutButton(): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut(): Promise<void> {
    setBusy(true);

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'x-csrf-token': readCsrfCookie() },
        credentials: 'same-origin',
      });
    } finally {
      // Navigate regardless: the cookies are cleared server-side either way.
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      style={{
        background: 'transparent',
        border: `1px solid ${theme.color.border}`,
        color: theme.color.textMuted,
        borderRadius: theme.radius.sm,
        padding: '6px 12px',
        fontSize: 13,
        cursor: busy ? 'not-allowed' : 'pointer',
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
```

FILE: apps/admin-web/src/components/ui.tsx

```tsx
import type { CSSProperties, ReactNode } from 'react';

import { theme, type StatusTone } from '@/lib/theme';

/**
 * Primitive presentational components.
 *
 * Deliberately dependency-free and inline-styled: the console must render
 * correctly in restricted preview environments where external stylesheets do
 * not load, and Part 1 should not lock the project into a component library.
 */

export function Card({
  title,
  description,
  actions,
  children,
  style,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <section
      style={{
        background: theme.color.surface,
        border: `1px solid ${theme.color.border}`,
        borderRadius: theme.radius.lg,
        padding: theme.space(6),
        ...style,
      }}
    >
      {(title || actions) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: theme.space(4),
            marginBottom: description || children ? theme.space(4) : 0,
          }}
        >
          <div>
            {title && (
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h2>
            )}
            {description && (
              <p style={{ margin: `${theme.space(1)} 0 0`, color: theme.color.textMuted, fontSize: 13 }}>
                {description}
              </p>
            )}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

const toneColors: Record<StatusTone, { fg: string; bg: string }> = {
  neutral: { fg: 'var(--wlct-color-text-muted)', bg: 'rgba(154, 165, 196, 0.14)' },
  success: { fg: 'var(--wlct-color-success)', bg: 'rgba(47, 191, 113, 0.14)' },
  warning: { fg: 'var(--wlct-color-warning)', bg: 'rgba(232, 163, 61, 0.16)' },
  danger: { fg: 'var(--wlct-color-danger)', bg: 'rgba(229, 72, 77, 0.16)' },
  info: { fg: 'var(--wlct-color-primary)', bg: 'rgba(79, 124, 255, 0.16)' },
};

export function Badge({ tone = 'neutral', children }: { tone?: StatusTone; children: ReactNode }): JSX.Element {
  const colors = toneColors[tone];

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.2,
        color: colors.fg,
        background: colors.bg,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}): JSX.Element {
  return (
    <div
      style={{
        background: theme.color.surface,
        border: `1px solid ${theme.color.border}`,
        borderRadius: theme.radius.md,
        padding: theme.space(4),
      }}
    >
      <div style={{ color: theme.color.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: theme.space(2) }}>{value}</div>
      {hint && (
        <div style={{ color: theme.color.textMuted, fontSize: 12, marginTop: theme.space(1) }}>{hint}</div>
      )}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }): JSX.Element {
  return (
    <div
      style={{
        padding: theme.space(10),
        textAlign: 'center',
        color: theme.color.textMuted,
        border: `1px dashed ${theme.color.border}`,
        borderRadius: theme.radius.md,
      }}
    >
      <div style={{ fontWeight: 600, color: theme.color.text }}>{title}</div>
      {description && <div style={{ marginTop: theme.space(2), fontSize: 13 }}>{description}</div>}
    </div>
  );
}

export function ErrorNotice({ title, message }: { title: string; message: string }): JSX.Element {
  return (
    <div
      role="alert"
      style={{
        padding: theme.space(4),
        borderRadius: theme.radius.md,
        border: '1px solid rgba(229, 72, 77, 0.4)',
        background: 'rgba(229, 72, 77, 0.1)',
        color: theme.color.text,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: theme.space(1) }}>{title}</div>
      <div style={{ fontSize: 13, color: theme.color.textMuted }}>{message}</div>
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  width?: string;
  align?: 'left' | 'right' | 'center';
}

export function DataTable<T>({
  columns,
  rows,
  emptyTitle = 'Nothing to show yet',
  emptyDescription,
  rowKey,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  emptyTitle?: string;
  emptyDescription?: string;
  rowKey: (row: T, index: number) => string;
}): JSX.Element {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ fontSize: 14 }}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={{
                  textAlign: column.align ?? 'left',
                  padding: `${theme.space(2)} ${theme.space(3)}`,
                  borderBottom: `1px solid ${theme.color.border}`,
                  color: theme.color.textMuted,
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                  fontWeight: 600,
                  width: column.width,
                  whiteSpace: 'nowrap',
                }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  style={{
                    textAlign: column.align ?? 'left',
                    padding: `${theme.space(3)} ${theme.space(3)}`,
                    borderBottom: `1px solid ${theme.color.border}`,
                    verticalAlign: 'top',
                  }}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <header
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: theme.space(4),
        marginBottom: theme.space(6),
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{title}</h1>
        {description && (
          <p style={{ margin: `${theme.space(2)} 0 0`, color: theme.color.textMuted, fontSize: 14, maxWidth: 720 }}>
            {description}
          </p>
        )}
      </div>
      {actions}
    </header>
  );
}
```

FILE: apps/admin-web/src/lib/api-client.ts

```typescript
'use client';

import { ApiError } from './api-error';

/**
 * Browser-side API client.
 *
 * It talks to this app's own `/api/proxy/*` route rather than the platform API
 * directly. That keeps the access token in an httpOnly cookie, avoids CORS
 * entirely, and gives one place to handle refresh-on-401.
 */
const PROXY_PREFIX = '/api/proxy';

function readCsrfCookie(): string {
  const match = document.cookie.match(/(?:^|;\s*)wlct_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export interface ClientFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  searchParams?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: ClientFetchOptions, retry: boolean): Promise<T> {
  const { method = 'GET', body, searchParams, signal } = options;

  const url = new URL(
    `${PROXY_PREFIX}${path.startsWith('/') ? path : `/${path}`}`,
    window.location.origin,
  );

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = { accept: 'application/json' };

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (method !== 'GET') {
    headers['x-csrf-token'] = readCsrfCookie();
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    signal,
  });

  if (response.status === 401 && retry) {
    // One silent refresh attempt, then give up and let the caller redirect.
    const refreshed = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': readCsrfCookie() },
    });

    if (refreshed.ok) {
      return request<T>(path, options, false);
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload: unknown = text.length > 0 ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw ApiError.fromBody(response.status, payload);
  }

  const envelope = payload as { success?: boolean; data?: T } | undefined;
  return envelope && 'data' in envelope ? (envelope.data as T) : (payload as T);
}

export const apiClient = {
  get: <T>(path: string, options: Omit<ClientFetchOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...options, method: 'GET' }, true),
  post: <T>(path: string, body?: unknown, options: ClientFetchOptions = {}) =>
    request<T>(path, { ...options, method: 'POST', body }, true),
  patch: <T>(path: string, body?: unknown, options: ClientFetchOptions = {}) =>
    request<T>(path, { ...options, method: 'PATCH', body }, true),
  put: <T>(path: string, body?: unknown, options: ClientFetchOptions = {}) =>
    request<T>(path, { ...options, method: 'PUT', body }, true),
  delete: <T>(path: string, options: ClientFetchOptions = {}) =>
    request<T>(path, { ...options, method: 'DELETE' }, true),
};
```

FILE: apps/admin-web/src/lib/api-error.ts

```typescript
/**
 * The error envelope produced by the API. Mirrors
 * `common/filters/global-exception.filter.ts` so both sides agree on shape.
 */
export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
    requestId?: string;
    timestamp?: string;
    path?: string;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Array<{ field: string; message: string }>,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromBody(status: number, body: unknown): ApiError {
    const envelope = body as Partial<ApiErrorBody>;

    if (envelope?.error?.code) {
      return new ApiError(
        status,
        envelope.error.code,
        envelope.error.message ?? 'The request could not be completed.',
        envelope.error.details,
        envelope.error.requestId,
      );
    }

    return new ApiError(status, 'UNKNOWN_ERROR', 'The request could not be completed.');
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.code === 'TOKEN_EXPIRED' || this.code === 'TOKEN_INVALID';
  }

  /** Field errors keyed by field name, ready to bind to form inputs. */
  get fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const detail of this.details ?? []) {
      map[detail.field] = detail.message;
    }
    return map;
  }
}
```

FILE: apps/admin-web/src/lib/env.ts

```typescript
import { z } from 'zod';

/**
 * Server-side configuration.
 *
 * Validated lazily on first use so a missing variable produces a clear error at
 * request time rather than a cryptic build failure. Only variables that are
 * safe in the browser carry the NEXT_PUBLIC_ prefix; everything here without it
 * is server-only and must never be imported into a client component.
 */
const serverSchema = z.object({
  API_BASE_URL: z.string().url(),
  ADMIN_TENANT_SLUG: z.string().min(1).default('platform'),
  SESSION_COOKIE_SECRET: z.string().min(16),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) {
    return cached;
  }

  const parsed = serverSchema.safeParse({
    API_BASE_URL: process.env.API_BASE_URL,
    ADMIN_TENANT_SLUG: process.env.ADMIN_TENANT_SLUG,
    SESSION_COOKIE_SECRET: process.env.SESSION_COOKIE_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid admin-web server configuration: ${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** Browser-visible configuration. Contains nothing sensitive. */
export const publicEnv = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'Copy Trading Console',
  apiVersion: process.env.NEXT_PUBLIC_API_VERSION ?? 'v1',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? '',
  wsPath: process.env.NEXT_PUBLIC_WS_PATH ?? '/socket.io',
} as const;
```

FILE: apps/admin-web/src/lib/format.ts

```typescript
/** Presentation helpers shared by server and client components. */

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }

  const date = typeof value === 'string' ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }

  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const thresholds: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ];

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  let value_ = deltaSeconds;

  for (const [unit, limit] of thresholds) {
    if (Math.abs(value_) < limit) {
      return formatter.format(Math.round(value_), unit);
    }
    value_ = value_ / limit;
  }

  return formatter.format(Math.round(value_), 'year');
}

/** Money arrives from the API as a decimal string; never parse it into a float. */
export function formatMoney(amount: string | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined || amount === '') {
    return '—';
  }

  const numeric = Number(amount);
  if (Number.isNaN(numeric)) {
    return amount;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function formatBasisPoints(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) {
    return '—';
  }
  return `${(bps / 100).toFixed(2)}%`;
}

export function formatLimit(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return 'Unlimited';
  }
  return new Intl.NumberFormat('en-US').format(value);
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
```

FILE: apps/admin-web/src/lib/server-api.ts

```typescript
import 'server-only';

import { randomUUID } from 'node:crypto';

import { ApiError } from './api-error';
import { serverEnv, publicEnv } from './env';
import { getAccessToken } from './session';

export interface ServerFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Attach the caller's session token. Off for unauthenticated endpoints. */
  authenticated?: boolean;
  /** Next.js cache directives. Admin data is uncached by default. */
  revalidate?: number | false;
  searchParams?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

function buildUrl(path: string, searchParams?: ServerFetchOptions['searchParams']): string {
  const env = serverEnv();
  const base = env.API_BASE_URL.replace(/\/+$/, '');
  const normalised = path.startsWith('/') ? path : `/${path}`;
  const versioned = normalised.startsWith(`/${publicEnv.apiVersion}/`)
    ? normalised
    : `/${publicEnv.apiVersion}${normalised}`;

  const url = new URL(`${base}${versioned}`);

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

/**
 * Calls the platform API from the server.
 *
 * All API traffic from the console goes through this function or the proxy
 * route handler that wraps it: the browser never holds a bearer token.
 */
export async function serverFetch<T>(path: string, options: ServerFetchOptions = {}): Promise<T> {
  const env = serverEnv();
  const { method = 'GET', body, authenticated = true, revalidate = 0, searchParams } = options;

  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-request-id': randomUUID(),
    'x-tenant-slug': env.ADMIN_TENANT_SLUG,
  };

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (authenticated) {
    const token = getAccessToken();
    if (!token) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.');
    }
    headers.authorization = `Bearer ${token}`;
  }

  let response: Response;

  try {
    response = await fetch(buildUrl(path, searchParams), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: revalidate === 0 ? 'no-store' : undefined,
      next: revalidate === 0 || revalidate === false ? undefined : { revalidate },
      signal: options.signal,
    });
  } catch {
    // Network-level failure: never surface the raw cause, it can leak internal
    // hostnames into the browser.
    throw new ApiError(
      503,
      'SERVICE_UNAVAILABLE',
      'The platform API is unreachable. Please try again shortly.',
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload: unknown = text.length > 0 ? safeJsonParse(text) : undefined;

  if (!response.ok) {
    throw ApiError.fromBody(response.status, payload);
  }

  const envelope = payload as { success?: boolean; data?: T } | undefined;

  return (envelope && 'data' in envelope ? (envelope.data as T) : (payload as T));
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
```

FILE: apps/admin-web/src/lib/session.ts

```typescript
import 'server-only';

import { cookies } from 'next/headers';

/**
 * Session storage.
 *
 * Tokens live exclusively in httpOnly, SameSite=Strict cookies. They are never
 * written to localStorage and never serialised into a client component payload,
 * so an XSS bug in the console cannot exfiltrate a session. Browser code talks
 * to the API only through this app's own proxy route, which attaches the token
 * server-side.
 */
export const ACCESS_TOKEN_COOKIE = 'wlct_at';
export const REFRESH_TOKEN_COOKIE = 'wlct_rt';
export const DEVICE_ID_COOKIE = 'wlct_did';
export const CSRF_COOKIE = 'wlct_csrf';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

function baseCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge,
  };
}

export function persistSession(tokens: SessionTokens, deviceId: string, csrfToken: string): void {
  const store = cookies();

  store.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, baseCookieOptions(tokens.expiresIn));
  store.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, baseCookieOptions(tokens.refreshExpiresIn));
  store.set(DEVICE_ID_COOKIE, deviceId, baseCookieOptions(tokens.refreshExpiresIn));

  // Double-submit CSRF token: readable by scripts on purpose so the client can
  // echo it in a header, while the cookie itself is same-site restricted.
  store.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: tokens.refreshExpiresIn,
  });
}

export function clearSession(): void {
  const store = cookies();
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, DEVICE_ID_COOKIE, CSRF_COOKIE]) {
    store.delete(name);
  }
}

export function getAccessToken(): string | null {
  return cookies().get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}

export function getRefreshToken(): string | null {
  return cookies().get(REFRESH_TOKEN_COOKIE)?.value ?? null;
}

export function getDeviceId(): string {
  return cookies().get(DEVICE_ID_COOKIE)?.value ?? '';
}

export function getCsrfToken(): string | null {
  return cookies().get(CSRF_COOKIE)?.value ?? null;
}

/**
 * Decodes the access token payload for display purposes only.
 *
 * The signature is deliberately not verified here: the API is the only
 * authority on validity. Nothing in the console grants access based on this.
 */
export function decodeAccessTokenClaims(
  token: string,
): { sub: string; tid: string; roles: string[]; perms: string[]; plat: boolean; exp: number } | null {
  const segments = token.split('.');
  if (segments.length !== 3 || !segments[1]) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;

    return {
      sub: String(payload.sub ?? ''),
      tid: String(payload.tid ?? ''),
      roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : [],
      perms: Array.isArray(payload.perms) ? (payload.perms as string[]) : [],
      plat: Boolean(payload.plat),
      exp: Number(payload.exp ?? 0),
    };
  } catch {
    return null;
  }
}
```

FILE: apps/admin-web/src/lib/theme.ts

```typescript
/**
 * Theme tokens.
 *
 * Kept as plain objects (no CSS-in-JS runtime) so server components can inline
 * them and tenant branding can override the CSS custom properties at request
 * time without shipping a second stylesheet.
 */
export const theme = {
  color: {
    bg: 'var(--wlct-color-bg)',
    surface: 'var(--wlct-color-surface)',
    surfaceRaised: 'var(--wlct-color-surface-raised)',
    border: 'var(--wlct-color-border)',
    text: 'var(--wlct-color-text)',
    textMuted: 'var(--wlct-color-text-muted)',
    primary: 'var(--wlct-color-primary)',
    primaryContrast: 'var(--wlct-color-primary-contrast)',
    success: 'var(--wlct-color-success)',
    warning: 'var(--wlct-color-warning)',
    danger: 'var(--wlct-color-danger)',
  },
  radius: {
    sm: 'var(--wlct-radius-sm)',
    md: 'var(--wlct-radius-md)',
    lg: 'var(--wlct-radius-lg)',
  },
  space: (units: number): string => `${units * 4}px`,
} as const;

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Maps API status enums onto a visual tone. Unknown values stay neutral. */
export function toneForStatus(status: string): StatusTone {
  const upper = status.toUpperCase();

  if (['ACTIVE', 'TRIALING', 'VERIFIED', 'APPROVED', 'OK', 'ENABLED'].includes(upper)) {
    return 'success';
  }
  if (['PENDING', 'PENDING_VERIFICATION', 'PAST_DUE', 'IN_REVIEW', 'TRIAL'].includes(upper)) {
    return 'warning';
  }
  if (['SUSPENDED', 'CANCELLED', 'CANCELED', 'REJECTED', 'LOCKED', 'ARCHIVED', 'FAILED', 'CRITICAL'].includes(upper)) {
    return 'danger';
  }
  if (['PROVISIONING', 'INVITED', 'INFO'].includes(upper)) {
    return 'info';
  }

  return 'neutral';
}

/**
 * Builds a CSS custom-property override block from tenant branding.
 * Values are validated as hex colours before use: branding is tenant-supplied
 * input and must never be injected into a style attribute unchecked.
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function brandingCssVariables(branding: {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
}): Record<string, string> {
  const variables: Record<string, string> = {};

  if (branding.primaryColor && HEX_COLOR.test(branding.primaryColor)) {
    variables['--wlct-color-primary'] = branding.primaryColor;
  }
  if (branding.secondaryColor && HEX_COLOR.test(branding.secondaryColor)) {
    variables['--wlct-color-surface-raised'] = branding.secondaryColor;
  }
  if (branding.accentColor && HEX_COLOR.test(branding.accentColor)) {
    variables['--wlct-color-success'] = branding.accentColor;
  }

  return variables;
}
```

FILE: apps/admin-web/src/middleware.ts

```typescript
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware.
 *
 * Two jobs, both cheap:
 *  1. Bounce unauthenticated navigation to /login before a server component
 *     tries (and fails) to fetch data.
 *  2. Attach a per-request Content-Security-Policy nonce and the security
 *     headers that must vary per response.
 *
 * The presence of a cookie is NOT treated as proof of authentication - the API
 * validates every token. This is a redirect optimisation, not access control.
 */
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/two-factor', '/api/auth/refresh'];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  const hasSession = Boolean(request.cookies.get('wlct_at')?.value);

  if (!isPublic && !hasSession && !pathname.startsWith('/api/')) {
    const loginUrl = new URL('/login', request.url);
    // Preserve the destination so the user lands where they intended.
    if (pathname !== '/') {
      loginUrl.searchParams.set('next', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  const nonce = crypto.randomUUID().replace(/-/g, '');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // 'unsafe-inline' for styles is required by the inline-style approach used in
  // the components; scripts stay nonce-locked, which is where XSS actually bites.
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${process.env.NODE_ENV === 'development' ? "'unsafe-eval'" : ''}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

FILE: apps/admin-web/src/styles/globals.css

```css
/*
 * Design tokens live as CSS custom properties so tenant branding can override
 * them at runtime from TenantBranding without a rebuild.
 */
:root {
  --wlct-color-bg: #0b1020;
  --wlct-color-surface: #131a2f;
  --wlct-color-surface-raised: #1a2340;
  --wlct-color-border: #26304d;
  --wlct-color-text: #e8ecf7;
  --wlct-color-text-muted: #9aa5c4;
  --wlct-color-primary: #4f7cff;
  --wlct-color-primary-contrast: #ffffff;
  --wlct-color-success: #2fbf71;
  --wlct-color-warning: #e8a33d;
  --wlct-color-danger: #e5484d;
  --wlct-radius-sm: 6px;
  --wlct-radius-md: 10px;
  --wlct-radius-lg: 16px;
  --wlct-font-sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial,
    sans-serif;
  --wlct-font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  background: var(--wlct-color-bg);
  color: var(--wlct-color-text);
  font-family: var(--wlct-font-sans);
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

a {
  color: var(--wlct-color-primary);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

button {
  font-family: inherit;
}

input,
select,
textarea {
  font-family: inherit;
  font-size: inherit;
}

table {
  border-collapse: collapse;
  width: 100%;
}

code {
  font-family: var(--wlct-font-mono);
  font-size: 0.85em;
}

:focus-visible {
  outline: 2px solid var(--wlct-color-primary);
  outline-offset: 2px;
}

.wlct-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

FILE: apps/admin-web/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"],
      "@wlct/shared-types": ["../../packages/shared-types/src/index.ts"],
      "@wlct/validation": ["../../packages/validation/src/index.ts"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

