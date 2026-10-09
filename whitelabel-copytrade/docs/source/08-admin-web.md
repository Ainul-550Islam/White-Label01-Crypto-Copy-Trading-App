# Admin console (Next.js)

Server-side session handling, the proxy route, and the console screens.

101 files. Part of the complete source dump - see `docs/source/README.md`.

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
    "typecheck": "tsc --noEmit",
    "test": "jest",
    "dev:e2e": "next dev -p 3102 -H 127.0.0.1"
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
    "zod": "^3.23.8",
    "@wlct/utils": "1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.10",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.0",
    "eslint": "^8.57.0",
    "eslint-config-next": "14.2.15",
    "typescript": "^5.5.4"
  },
  "jest": {
    "rootDir": "src",
    "testEnvironment": "node",
    "testRegex": "\\.test\\.tsx?$",
    "moduleNameMapper": {
      "^@/(.*)$": "<rootDir>/$1",
      "^@wlct/utils/api-error$": "<rootDir>/../../../packages/utils/src/api-error.ts"
    },
    "transform": {
      "^.+\\.tsx?$": [
        "ts-jest",
        {
          "isolatedModules": true,
          "tsconfig": {
            "jsx": "react-jsx"
          }
        }
      ]
    }
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
import { ApiError } from '@wlct/utils/api-error';
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

FILE: apps/admin-web/src/app/(console)/billing/checkout/page.tsx

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';

import { ErrorNotice } from '@/components/ui';
import CheckoutPage from '@/modules/billing/portal/checkout-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Checkout' };

/**
 * Round 7: two entry points share this route.
 *  - /billing/checkout?planId=<id> starts a checkout for that plan;
 *  - the provider redirects back to /billing/checkout?checkout_id=<id>
 *    (or payment_id / session_id), and CheckoutPage asks the API for the real
 *    payment state - the query string itself is never trusted as success.
 * With neither, there is nothing to do, so the page says so.
 */
export default function BillingCheckoutPage({
  searchParams,
}: {
  searchParams: { planId?: string; checkout_id?: string; payment_id?: string; session_id?: string };
}): JSX.Element {
  const planId = typeof searchParams.planId === 'string' ? searchParams.planId.trim() : '';
  const returning = Boolean(searchParams.checkout_id || searchParams.payment_id || searchParams.session_id);

  if (!planId && !returning) {
    return (
      <div className="p-6 space-y-4">
        <ErrorNotice title="No plan selected" message="Choose a plan first, then start the checkout from there." />
        <Link href="/billing/plans" className="text-sm text-blue-600 hover:underline">
          Compare plans
        </Link>
      </div>
    );
  }

  return <CheckoutPage planId={planId} />;
}
```

FILE: apps/admin-web/src/app/(console)/billing/layout.tsx

```tsx
import type { ReactNode } from 'react';

import { BillingScope } from '@/modules/billing/billing-scope';

/** Round 7: mounts the self-service billing portal inside the billing style scope. */
export default function BillingLayout({ children }: { children: ReactNode }): JSX.Element {
  return <BillingScope>{children}</BillingScope>;
}
```

FILE: apps/admin-web/src/app/(console)/billing/page.tsx

```tsx
import type { Metadata } from 'next';

import OwnPlanLimitsPanel from '@/modules/billing/entitlements/own-plan-limits-panel';
import BillingPortalPage from '@/modules/billing/portal/billing-portal-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Billing' };

/**
 * Round 7: the organisation's billing portal (overview, invoices, payments,
 * usage) followed by the plan limits the API enforces. Data comes from
 * /v1/billing/portal/* and /v1/billing/subscription/limits; the API requires
 * subscription:read for all of it and scopes everything to the caller's tenant.
 */
export default function BillingPage(): JSX.Element {
  return (
    <>
      <BillingPortalPage />
      <OwnPlanLimitsPanel />
    </>
  );
}
```

FILE: apps/admin-web/src/app/(console)/billing/plans/page.tsx

```tsx
import type { Metadata } from 'next';

import PlanComparisonPage from '@/modules/billing/portal/plan-comparison';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Compare plans' };

/**
 * Round 7: plan comparison and upgrade. Starting a checkout needs
 * subscription:manage; the API decides provider and price, never the browser.
 * It is also the cancel URL of every checkout the portal starts.
 */
export default function BillingPlansPage(): JSX.Element {
  return <PlanComparisonPage />;
}
```

FILE: apps/admin-web/src/app/(console)/billing/subscription/page.tsx

```tsx
import type { Metadata } from 'next';

import SubscriptionManagementPage from '@/modules/billing/portal/subscription-management';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Manage subscription' };

/**
 * Round 7: cancel, resume, change plan and change interval through
 * /v1/billing/portal/subscription/*. Every write needs subscription:manage
 * and is decided by the API.
 */
export default function BillingSubscriptionPage(): JSX.Element {
  return <SubscriptionManagementPage />;
}
```

FILE: apps/admin-web/src/app/(console)/branding/page.tsx

```tsx
import type { Metadata } from 'next';

import { Card, ErrorNotice, PageHeader } from '@/components/ui';
import { ApiError } from '@wlct/utils/api-error';
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

FILE: apps/admin-web/src/app/(console)/compliance/[caseId]/page.tsx

```tsx
// # NEW — Admin route for single compliance case review
import type { Metadata } from 'next';
import Link from 'next/link';
import { ErrorNotice, PageHeader } from '@/components/ui';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';
import {
  ComplianceCaseDetail,
  type ComplianceCaseRecord,
} from '@/features/compliance/compliance-case-detail';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Compliance Case Review' };

export default async function ComplianceCaseDetailPage({
  params,
}: {
  params: { caseId: string };
}): Promise<JSX.Element> {
  const { caseId } = params;
  let caseRecord: ComplianceCaseRecord | null = null;
  let errorMsg: string | null = null;

  try {
    caseRecord = await serverFetch<ComplianceCaseRecord>(`/compliance/cases/${caseId}`);
  } catch (err) {
    errorMsg = (err as Error).message || 'Failed to load compliance case';
  }

  return (
    <>
      <div style={{ marginBottom: theme.space(3) }}>
        <Link href="/compliance" style={{ fontSize: 12, color: theme.color.textMuted }}>
          ← Back to Compliance Case Queue
        </Link>
      </div>

      <PageHeader
        title={`Compliance Case Review · ${caseId.slice(0, 12)}`}
        description="Inspect KYC/AML screening matches, transaction monitoring evidence, and record an audited compliance decision."
      />

      {errorMsg && (
        <div style={{ marginTop: theme.space(4) }}>
          <ErrorNotice title="Could not load compliance case" message={errorMsg} />
        </div>
      )}

      {caseRecord && (
        <div style={{ marginTop: theme.space(5) }}>
          <ComplianceCaseDetail caseRecord={caseRecord} />
        </div>
      )}
    </>
  );
}
```

FILE: apps/admin-web/src/app/(console)/compliance/page.tsx

```tsx
// # NEW — Admin console route for compliance cases and KYC/AML queue
import type { Metadata } from 'next';
import { Card, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';
import {
  ComplianceCaseQueue,
  type ComplianceCaseQueueItem,
} from '@/features/compliance/compliance-case-queue';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Compliance & AML Case Queue' };

export default async function ComplianceQueuePage(): Promise<JSX.Element> {
  const failures: string[] = [];
  const track = async <T,>(label: string, promise: Promise<T>): Promise<T | null> => {
    try {
      return await promise;
    } catch (err) {
      failures.push(`${label}: ${(err as Error).message}`);
      return null;
    }
  };

  // Both endpoints answer with the platform's paged envelope - `{ data, total, page, limit }` from
  // `complianceCase.repository.listTenantCases` and `transactionMonitoringService.listSignals`.
  // This page asked for `items` and `cases`, neither of which those services return, so the queue
  // rendered empty against the real API while the console reported no failure at all: a silent
  // empty page is indistinguishable from a tenant with no cases, which is the worst way for a
  // compliance screen to be wrong.
  const [casesRes, signalsRes] = await Promise.all([
    track(
      'compliance cases',
      serverFetch<{ data?: ComplianceCaseQueueItem[]; total?: number }>('/compliance/cases', {
        searchParams: { limit: 50 },
      }),
    ),
    track(
      'monitoring signals',
      serverFetch<{ data?: unknown[]; total?: number }>('/compliance/monitoring/signals', {
        searchParams: { limit: 25 },
      }),
    ),
  ]);

  const cases = casesRes?.data ?? [];
  const openCases = cases.filter((c) => c.state !== 'RESOLVED' && c.state !== 'CLOSED');
  const escalatedCases = openCases.filter(
    (c) => c.state === 'ESCALATED' || c.riskLevel === 'CRITICAL' || c.riskLevel === 'HIGH',
  );

  return (
    <>
      <PageHeader
        title="Compliance, KYC/AML & Transaction Monitoring Queue"
        description="Review KYC/AML screening hits, transaction monitoring alerts, EDD requests, and compliance holds."
      />

      {failures.length > 0 && (
        <div style={{ marginTop: theme.space(4) }}>
          <ErrorNotice title="Compliance data partially degraded" message={failures.join(' · ')} />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: theme.space(4),
          marginTop: theme.space(5),
        }}
      >
        <StatTile
          label="Open Cases"
          value={openCases.length}
          hint={`${cases.length} total cases in queue`}
        />
        <StatTile
          label="High / Escalated"
          value={escalatedCases.length}
          hint="Priority MLRO review required"
        />
        <StatTile
          label="Monitoring Signals"
          value={signalsRes?.total ?? signalsRes?.data?.length ?? 0}
          hint="Velocity, structuring & jurisdiction alerts"
        />
      </div>

      <div style={{ marginTop: theme.space(6) }}>
        <Card
          title="Compliance Case Queue"
          description="Filter cases by workflow state, severity, and SLA. Click a case ID to inspect evidence, AML hits, and record a decision."
        >
          <ComplianceCaseQueue cases={cases} />
        </Card>
      </div>
    </>
  );
}
```

FILE: apps/admin-web/src/app/(console)/dashboard/page.tsx

```tsx
import type { Metadata } from 'next';

import { Card, ErrorNotice, StatTile, Badge } from '@/components/ui';
import { ApiError } from '@wlct/utils/api-error';
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
import { ApiError } from '@wlct/utils/api-error';
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

FILE: apps/admin-web/src/app/(console)/execution-incidents/page.tsx

```tsx
// # NEW — Admin console route for execution incidents and stuck orders
import type { Metadata } from 'next';
import { Card, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';
import {
  ExecutionIncidentTable,
  type ExecutionIncidentRow,
  type ExecutionKillSwitchItem,
} from '@/features/execution/execution-incident-table';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Execution Incidents & Safety' };

interface IncidentCountsResponse {
  open: number;
  critical: number;
  warning: number;
  info: number;
  stale: number;
}

interface ExecutionSafetyResponse {
  tradingMode: string;
  executionEnabled: boolean;
  liveTradingEnabled: boolean;
  dryRun: boolean;
  paperTrading: boolean;
  sandboxMode: boolean;
  wouldTransmitLiveOrder: boolean;
  blockingReasons: string[];
  killSwitches: ExecutionKillSwitchItem[];
}

export default async function ExecutionIncidentsPage(): Promise<JSX.Element> {
  const failures: string[] = [];
  const track = async <T,>(label: string, promise: Promise<T>): Promise<T | null> => {
    try {
      return await promise;
    } catch (err) {
      failures.push(`${label}: ${(err as Error).message}`);
      return null;
    }
  };

  const [counts, safety, incidentsPage] = await Promise.all([
    track('incident counts', serverFetch<IncidentCountsResponse>('/execution/incidents/counts')),
    track('execution safety', serverFetch<ExecutionSafetyResponse>('/execution/safety')),
    track(
      'execution incidents',
      serverFetch<{ items: ExecutionIncidentRow[] }>('/execution/incidents', {
        searchParams: { limit: 50, includeResolved: true },
      }),
    ),
  ]);

  const incidents = incidentsPage?.items ?? [];
  const killSwitches = safety?.killSwitches ?? [];

  return (
    <>
      <PageHeader
        title="Execution Incidents & Kill-Switch Console"
        description="Operational incident queue, stuck-order diagnostics, deployment safety gate status, and audited kill-switch controls."
      />

      {failures.length > 0 && (
        <div style={{ marginTop: theme.space(4) }}>
          <ErrorNotice title="Some execution panels degraded" message={failures.join(' · ')} />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: theme.space(4),
          marginTop: theme.space(5),
        }}
      >
        <StatTile
          label="Open Incidents"
          value={counts?.open ?? 0}
          hint={`${counts?.critical ?? 0} critical · ${counts?.stale ?? 0} stale (>1h)`}
        />
        <StatTile
          label="Trading Mode"
          value={safety?.tradingMode ?? 'PAPER'}
          hint={
            safety?.wouldTransmitLiveOrder
              ? 'Live orders armed'
              : 'Live transmission blocked by safety gate'
          }
        />
        <StatTile
          label="Active Kill Switches"
          value={killSwitches.filter((k) => k.isEngaged).length}
          hint={`${killSwitches.length} total recorded switches`}
        />
        <StatTile
          label="Safety Gate Blockers"
          value={safety?.blockingReasons.length ?? 0}
          hint={safety?.blockingReasons[0] ?? 'No blockers'}
        />
      </div>

      <div style={{ marginTop: theme.space(6) }}>
        <Card
          title="Execution Incidents & Safety Controls"
          description="Engage or release scoped kill switches and resolve execution incidents with an immutable audit note."
        >
          <ExecutionIncidentTable incidents={incidents} killSwitches={killSwitches} />
        </Card>
      </div>
    </>
  );
}
```

FILE: apps/admin-web/src/app/(console)/funding-reconciliation/page.tsx

```tsx
// # NEW — Admin console route for funding and custody reconciliation
import type { Metadata } from 'next';
import { Card, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';
import {
  FundingReconciliationTable,
  type CustodyReconciliationFindingRow,
} from '@/features/funding/funding-reconciliation-table';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Funding & Custody Reconciliation' };

export default async function FundingReconciliationPage(): Promise<JSX.Element> {
  let findings: CustodyReconciliationFindingRow[] = [];
  let errorMsg: string | null = null;

  try {
    const res = await serverFetch<{
      items?: CustodyReconciliationFindingRow[];
      findings?: CustodyReconciliationFindingRow[];
    }>('/custody/reconciliation/findings', {
      searchParams: { limit: 50 },
    });
    findings = res.items ?? res.findings ?? [];
  } catch (err) {
    errorMsg = (err as Error).message || 'Failed to load custody reconciliation findings';
  }

  const openFindings = findings.filter((f) => !f.resolved);
  const criticalFindings = openFindings.filter(
    (f) => f.severity === 'CRITICAL' || f.severity === 'HIGH',
  );

  return (
    <>
      <PageHeader
        title="Funding & Custody Reconciliation"
        description="Reconcile internal ledger balances, deposit confirmations, and withdrawal settlements against external custody and payment providers."
      />

      {errorMsg && (
        <div style={{ marginTop: theme.space(4) }}>
          <ErrorNotice title="Reconciliation query failed" message={errorMsg} />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: theme.space(4),
          marginTop: theme.space(5),
        }}
      >
        <StatTile
          label="Open Findings"
          value={openFindings.length}
          hint={`${findings.length} total recorded findings`}
        />
        <StatTile
          label="Critical / High"
          value={criticalFindings.length}
          hint="Requires treasury operator review"
        />
        <StatTile
          label="Resolved Findings"
          value={findings.filter((f) => f.resolved).length}
          hint="Audited resolution records"
        />
      </div>

      <div style={{ marginTop: theme.space(6) }}>
        <Card
          title="Custody & Funding Settlement Discrepancies"
          description="Never rewrites external provider truth; requires explicit operator resolution and audit note."
        >
          <FundingReconciliationTable findings={findings} />
        </Card>
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

FILE: apps/admin-web/src/app/(console)/lead-trader-applications/page.tsx

```tsx
// # Responsibility: serves the tenant-scoped lead-trader review queue in the authenticated admin console.
import type { Metadata } from 'next';
import { Card, ErrorNotice, PageHeader } from '@/components/ui';
import { LeadTraderApplicationQueue, type AdminLeadTraderApplication } from '@/features/trading/lead-trader-application-queue';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Lead Trader Applications' };

interface LeadTraderApplicationQueueResponse {
  data: AdminLeadTraderApplication[];
  total: number;
  page: number;
  limit: number;
}

export default async function LeadTraderApplicationsPage(): Promise<JSX.Element> {
  let queue: LeadTraderApplicationQueueResponse = { data: [], total: 0, page: 1, limit: 50 };
  let errorMessage: string | null = null;
  try {
    queue = await serverFetch<LeadTraderApplicationQueueResponse>('/copy-trading/lead-trader-applications/admin', {
      searchParams: { page: 1, limit: 50 },
    });
  } catch (error) {
    errorMessage = (error as Error).message || 'Could not load lead-trader applications.';
  }

  return (
    <>
      <PageHeader
        title="Lead Trader Applications"
        description="Review tenant-scoped qualification declarations. Approval is separate from trader performance verification and live-execution authorization."
      />
      {errorMessage && (
        <div style={{ marginTop: theme.space(4) }}>
          <ErrorNotice title="Application queue unavailable" message={errorMessage} />
        </div>
      )}
      <div style={{ marginTop: theme.space(5) }}>
        <Card title="Qualification review queue" description="Claim an application before deciding it. Rejections require a reason and preserve the submitted version.">
          <LeadTraderApplicationQueue initialQueue={queue} />
        </Card>
      </div>
    </>
  );
}
```

FILE: apps/admin-web/src/app/(console)/observability/alert-controls.tsx

```tsx
'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui';
import { ApiError } from '@wlct/utils/api-error';
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
import { ApiError } from '@wlct/utils/api-error';
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

FILE: apps/admin-web/src/app/(console)/partners/[partnerId]/page.tsx

```tsx
// # NEW — Admin detail route for partner attribution and commission audit
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, DataTable, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { serverFetch } from '@/lib/server-api';
import { formatDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Partner Attribution & Commission Audit' };

interface PartnerDetailDto {
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

interface PartnerCommissionDto {
  id: string;
  tenantId: string;
  sourceEventType: string;
  grossRevenue: string;
  commissionAmount: string;
  currency: string;
  state: string;
  createdAt: string;
}

interface PartnerPayoutDto {
  id: string;
  settlementId: string;
  amount: string;
  currency: string;
  method: string;
  state: string;
  createdAt: string;
}

export default async function AdminPartnerDetailPage({
  params,
}: {
  params: { partnerId: string };
}): Promise<JSX.Element> {
  const { partnerId } = params;
  const failures: string[] = [];
  const track = async <T,>(label: string, promise: Promise<T>): Promise<T | null> => {
    try {
      return await promise;
    } catch (err) {
      failures.push(`${label}: ${(err as Error).message}`);
      return null;
    }
  };

  const [partner, commissionsRes, payoutsRes] = await Promise.all([
    track('partner profile', serverFetch<PartnerDetailDto>(`/partners/${partnerId}`)),
    track('commissions', serverFetch<PartnerCommissionDto[]>(`/partners/${partnerId}/commissions`)),
    track('payouts', serverFetch<PartnerPayoutDto[]>(`/partners/${partnerId}/payouts`)),
  ]);

  const commissions = Array.isArray(commissionsRes) ? commissionsRes : [];
  const payouts = Array.isArray(payoutsRes) ? payoutsRes : [];

  return (
    <>
      <div style={{ marginBottom: theme.space(3) }}>
        <Link href="/partners" style={{ fontSize: 12, color: theme.color.textMuted }}>
          ← Back to Partners Directory
        </Link>
      </div>

      <PageHeader
        title={`Partner Audit · ${partner?.name ?? partnerId}`}
        description="Inspect partner referral attributions, commission accruals, and payout settlement state."
      />

      {failures.length > 0 && (
        <div style={{ marginTop: theme.space(4) }}>
          <ErrorNotice title="Partner detail partially degraded" message={failures.join(' · ')} />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: theme.space(4),
          marginTop: theme.space(5),
        }}
      >
        <StatTile label="Partner State" value={partner?.state ?? 'UNKNOWN'} hint={partner?.type ?? '—'} />
        <StatTile
          label="Commission Entries"
          value={commissions.length}
          hint="Trade & fee rebate accruals"
        />
        <StatTile label="Payout Requests" value={payouts.length} hint="Disbursement records" />
      </div>

      <div style={{ marginTop: theme.space(6), display: 'grid', gap: theme.space(5) }}>
        <Card title="Commission Accrual Audit" description="Partner commission ledger entries.">
          <DataTable
            rows={commissions}
            rowKey={(r) => r.id}
            emptyTitle="No commission entries"
            emptyDescription="Zero commissions accrued for this partner."
            columns={[
              { key: 'id', header: 'ID', render: (r) => <code>{r.id.slice(0, 10)}</code> },
              { key: 'tenant', header: 'Tenant', render: (r) => <code>{r.tenantId}</code> },
              { key: 'event', header: 'Source Event', render: (r) => r.sourceEventType },
              {
                key: 'gross',
                header: 'Gross Revenue',
                render: (r) => `${r.grossRevenue} ${r.currency}`,
              },
              {
                key: 'commission',
                header: 'Commission',
                render: (r) => `${r.commissionAmount} ${r.currency}`,
              },
              { key: 'state', header: 'State', render: (r) => <Badge tone="info">{r.state}</Badge> },
              { key: 'created', header: 'Created', render: (r) => formatDateTime(r.createdAt) },
            ]}
          />
        </Card>

        <Card title="Payout Disbursement Audit" description="Partner payout requests and settlements.">
          <DataTable
            rows={payouts}
            rowKey={(r) => r.id}
            emptyTitle="No payout records"
            emptyDescription="Zero payout requests submitted by this partner."
            columns={[
              { key: 'id', header: 'Payout ID', render: (r) => <code>{r.id.slice(0, 10)}</code> },
              {
                key: 'settlement',
                header: 'Settlement',
                render: (r) => <code>{r.settlementId}</code>,
              },
              { key: 'amount', header: 'Amount', render: (r) => `${r.amount} ${r.currency}` },
              { key: 'method', header: 'Method', render: (r) => r.method },
              { key: 'state', header: 'State', render: (r) => <Badge tone="info">{r.state}</Badge> },
              { key: 'created', header: 'Requested', render: (r) => formatDateTime(r.createdAt) },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
```

FILE: apps/admin-web/src/app/(console)/partners/page.tsx

```tsx
// # NEW — Admin console route for partner approval, tier assignment, and payout review
import type { Metadata } from 'next';
import { Card, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';
import {
  PartnerAdminTable,
  type PartnerAdminRow,
} from '@/features/partners/partner-admin-table';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Partners & Affiliate Management' };

export default async function AdminPartnersPage(): Promise<JSX.Element> {
  let partners: PartnerAdminRow[] = [];
  let errorMsg: string | null = null;

  try {
    const res = await serverFetch<PartnerAdminRow[] | { items?: PartnerAdminRow[] }>('/partners');
    partners = Array.isArray(res) ? res : (res.items ?? []);
  } catch (err) {
    errorMsg = (err as Error).message || 'Failed to load partner profiles';
  }

  const activeCount = partners.filter((p) => p.state === 'ACTIVE').length;
  const pendingCount = partners.filter(
    (p) => p.state === 'PENDING' || p.state === 'APPLIED' || p.state === 'DRAFT',
  ).length;

  return (
    <>
      <PageHeader
        title="Partner, IB & Affiliate Management Console"
        description="Approve partner applications, manage tiered rebate agreements, audit referral attributions, and review commission payouts."
      />

      {errorMsg && (
        <div style={{ marginTop: theme.space(4) }}>
          <ErrorNotice title="Could not load partners" message={errorMsg} />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: theme.space(4),
          marginTop: theme.space(5),
        }}
      >
        <StatTile label="Total Partners" value={partners.length} hint="IBs, Affiliates & Resellers" />
        <StatTile label="Active Partners" value={activeCount} hint="Eligible for commission accrual" />
        <StatTile label="Pending Review" value={pendingCount} hint="Awaiting agreement approval" />
      </div>

      <div style={{ marginTop: theme.space(6) }}>
        <Card
          title="Partner & Introducing Broker Directory"
          description="Activate or suspend partners and inspect individual attribution and payout ledgers."
        >
          <PartnerAdminTable partners={partners} />
        </Card>
      </div>
    </>
  );
}
```

FILE: apps/admin-web/src/app/(console)/plans/layout.tsx

```tsx
import type { ReactNode } from 'react';

import { BillingScope } from '@/modules/billing/billing-scope';

/** Round 7: mounts the plan catalogue inside the billing style scope. */
export default function PlansLayout({ children }: { children: ReactNode }): JSX.Element {
  return <BillingScope>{children}</BillingScope>;
}
```

FILE: apps/admin-web/src/app/(console)/plans/page.tsx

```tsx
import type { Metadata } from 'next';

import { getConsoleClaims, hasPermission } from '@/lib/console-claims';
import PlanCatalogManagement from '@/modules/billing/plans/plan-catalog-management';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Plan catalogue' };

/**
 * Round 7: the plan catalogue over /v1/billing/plans. Listing needs plan:read;
 * the create / edit / activate / deactivate / archive controls are rendered
 * only for plan:manage holders, and the API enforces the same permission (and
 * platform-vs-tenant ownership of each plan) on every write regardless.
 */
export default function PlansPage(): JSX.Element {
  const claims = getConsoleClaims();
  return <PlanCatalogManagement canManage={hasPermission(claims, 'plan:manage')} />;
}
```

FILE: apps/admin-web/src/app/(console)/risk/page.tsx

```tsx
// # Wires kill-switch controls to live execution safety endpoints
import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { ApiError } from '@wlct/utils/api-error';
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
// # Renders platform/tenant/venue/symbol kill-switch toggles with mandatory reason and confirmation
'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui';
import { ApiError } from '@wlct/utils/api-error';
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
import { ApiError } from '@wlct/utils/api-error';
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

FILE: apps/admin-web/src/app/(console)/saas-admin/layout.tsx

```tsx
import type { ReactNode } from 'react';

import { BillingScope } from '@/modules/billing/billing-scope';

/** Round 7: mounts platform SaaS tenant administration inside the billing style scope. */
export default function SaasAdminLayout({ children }: { children: ReactNode }): JSX.Element {
  return <BillingScope>{children}</BillingScope>;
}
```

FILE: apps/admin-web/src/app/(console)/saas-admin/page.tsx

```tsx
import type { Metadata } from 'next';

import { ErrorNotice } from '@/components/ui';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';
import SaasTenantManagementPage from '@/modules/billing/saas-admin/saas-tenant-management';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'SaaS tenants' };

/**
 * Round 7: platform-wide tenant administration (provision, suspend,
 * reactivate, per-tenant subscription state). Only platform operators with
 * platform:manage get anything from /v1/billing/saas-admin/*; a tenant admin
 * would only collect 403s, so the page explains that instead of rendering
 * an empty console. The API remains the actual gate.
 */
export default function SaasAdminPage(): JSX.Element {
  const claims = getConsoleClaims();
  if (!claims?.isPlatformUser || !hasPermission(claims, 'platform:manage')) {
    return (
      <div className="p-6">
        <ErrorNotice
          title="Platform operators only"
          message="SaaS tenant administration requires a platform operator account with the platform:manage permission."
        />
      </div>
    );
  }
  return <SaasTenantManagementPage />;
}
```

FILE: apps/admin-web/src/app/(console)/saas-admin/tenants/[id]/page.tsx

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';

import { ErrorNotice } from '@/components/ui';
import { getConsoleClaims, hasPermission } from '@/lib/console-claims';
import TenantEntitlementsPanel from '@/modules/billing/entitlements/tenant-entitlements-panel';
import SaasPlanManagementPage from '@/modules/billing/saas-admin/saas-plan-management';
import TenantBrandingDomainPage from '@/modules/billing/saas-admin/tenant-branding-domain';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'SaaS tenant' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Round 7: one tenant's plan / interval changes, branding, custom domains and
 * effective entitlements, for platform operators. The id must be a UUID
 * (the API's ParseUuidPipe would reject anything else with 400 anyway).
 */
export default function SaasTenantDetailPage({ params }: { params: { id: string } }): JSX.Element {
  const claims = getConsoleClaims();
  if (!claims?.isPlatformUser || !hasPermission(claims, 'platform:manage')) {
    return (
      <div className="p-6">
        <ErrorNotice
          title="Platform operators only"
          message="Tenant plan, branding, domain and entitlement management requires a platform operator account with the platform:manage permission."
        />
      </div>
    );
  }

  const tenantId = decodeURIComponent(params.id);
  if (!UUID_PATTERN.test(tenantId)) {
    return (
      <div className="p-6 space-y-4">
        <ErrorNotice title="Unknown tenant" message="The tenant id in the address is not valid." />
        <Link href="/saas-admin" className="text-sm text-blue-600 hover:underline">
          Back to SaaS tenants
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="p-6">
        <Link href="/saas-admin" className="text-sm text-blue-600 hover:underline">
          Back to SaaS tenants
        </Link>
      </div>
      <SaasPlanManagementPage tenantId={tenantId} />
      <TenantBrandingDomainPage tenantId={tenantId} />
      <div className="p-6">
        <TenantEntitlementsPanel tenantId={tenantId} />
      </div>
    </div>
  );
}
```

FILE: apps/admin-web/src/app/(console)/settings/page.tsx

```tsx
import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, type Column } from '@/components/ui';
import { ApiError } from '@wlct/utils/api-error';
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
import { ApiError } from '@wlct/utils/api-error';
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

import { ApiError } from '@wlct/utils/api-error';
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
import { ApiError } from '@wlct/utils/api-error';
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
import { ApiError } from '@wlct/utils/api-error';
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
import { ApiError } from '@wlct/utils/api-error';
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
import { ApiError } from '@wlct/utils/api-error';
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

import { ApiError } from '@wlct/utils/api-error';
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

import { ApiError } from '@wlct/utils/api-error';
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

import { ApiError } from '@wlct/utils/api-error';
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
  // Round 7: these two entries used 'billing:read' and 'audit:read', which
  // are not permissions (packages/shared-types rbac.ts), so the links were
  // hidden from everyone except '*' holders. They now name the permissions
  // the API actually enforces on the routes the pages call.
  { href: '/subscription', label: 'Subscription', permission: 'subscription:read' },
  // Round 7: the self-service billing portal (plans, checkout, invoices,
  // usage) and the plan catalogue. Both were built but never mounted.
  { href: '/billing', label: 'Billing', permission: 'subscription:read' },
  { href: '/plans', label: 'Plan catalogue', permission: 'plan:read' },
  // Platform-wide SaaS tenant administration (plan, branding, domains,
  // entitlements per tenant). The API requires platform:manage on every call.
  { href: '/saas-admin', label: 'SaaS tenants', permission: 'platform:manage', platformOnly: true },
  { href: '/audit-logs', label: 'Audit log', permission: 'audit_log:read' },
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

FILE: apps/admin-web/src/features/compliance/aml-screening-panel.tsx

```tsx
// # NEW — Displays screening match details and disposition controls
// # NEW — initiate/rescreen/disposition UI
'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui';
import { apiClient } from '@/lib/api-client';
import { ApiError } from '@wlct/utils/api-error';
import { theme } from '@/lib/theme';

export interface AmlScreeningMatch {
  id: string;
  listName: string;
  matchCategory: 'SANCTIONS' | 'PEP' | 'WATCHLIST' | 'ADVERSE_MEDIA';
  confidenceScore: number;
  matchedEntityLabel: string;
  jurisdiction?: string | null;
  disposition: 'PENDING_REVIEW' | 'TRUE_MATCH' | 'FALSE_POSITIVE' | 'ESCALATED';
}

export interface AmlScreeningPanelProps {
  userId: string;
  providerReference?: string | null;
  screeningStatus: string;
  matches: AmlScreeningMatch[];
}

export function hasUnresolvedSanctionsHit(matches: ReadonlyArray<AmlScreeningMatch>): boolean {
  return matches.some(
    (m) => m.disposition === 'PENDING_REVIEW' || m.disposition === 'TRUE_MATCH',
  );
}

export function AmlScreeningPanel({
  userId,
  providerReference,
  screeningStatus,
  matches,
}: AmlScreeningPanelProps): JSX.Element {
  const router = useRouter();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleRescreen = () => {
    if (!providerReference) return;
    setErrorMessage(null);
    setStatusMessage(null);
    startTransition(async () => {
      try {
        await apiClient.post(`/compliance/aml/rescreen/${providerReference}`, {
          userId,
        });
        setStatusMessage('AML/Sanctions rescreen request submitted.');
        router.refresh();
      } catch (err) {
        setErrorMessage(
          err instanceof ApiError ? err.message : (err as Error).message || 'AML rescreen failed.',
        );
      }
    });
  };

  return (
    <div
      data-testid="aml-screening-panel"
      style={{
        border: `1px solid ${theme.color.border}`,
        borderRadius: theme.radius.md,
        padding: theme.space(4),
        display: 'grid',
        gap: theme.space(3),
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            AML / Sanctions / PEP Screening Status: <Badge tone="info">{screeningStatus}</Badge>
          </div>
          <div style={{ fontSize: 12, color: theme.color.textMuted, marginTop: 2 }}>
            Subject User: <code>{userId}</code> · Provider Ref:{' '}
            <code>{providerReference ?? 'NONE'}</code>
          </div>
        </div>
        {providerReference && (
          <button
            type="button"
            disabled={pending}
            onClick={handleRescreen}
            style={{
              fontSize: 12,
              padding: '6px 12px',
              borderRadius: theme.radius.md,
              border: `1px solid ${theme.color.border}`,
              cursor: 'pointer',
            }}
          >
            {pending ? 'Rescreening…' : 'Trigger AML Rescreen'}
          </button>
        )}
      </div>

      {errorMessage && (
        <p role="alert" style={{ color: 'var(--wlct-color-danger)', fontSize: 12, margin: 0 }}>
          {errorMessage}
        </p>
      )}
      {statusMessage && (
        <p role="status" style={{ fontSize: 12, margin: 0 }}>
          {statusMessage}
        </p>
      )}

      {matches.length === 0 ? (
        <div style={{ fontSize: 12, color: theme.color.textMuted }}>
          No sanctions, PEP, or watchlist hits recorded for this subject.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: theme.space(2) }}>
          {matches.map((m) => (
            <div
              key={m.id}
              data-testid={`aml-match-${m.id}`}
              style={{
                padding: theme.space(3),
                border: `1px solid ${theme.color.border}`,
                borderRadius: theme.radius.sm,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {m.matchCategory} · {m.listName} ({m.confidenceScore}% confidence)
                </div>
                <div style={{ fontSize: 12, color: theme.color.textMuted }}>
                  Matched Label: {m.matchedEntityLabel}
                  {m.jurisdiction ? ` · Jurisdiction: ${m.jurisdiction}` : ''}
                </div>
              </div>
              <Badge tone={m.disposition === 'TRUE_MATCH' ? 'danger' : 'warning'}>
                {m.disposition}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AmlScreeningPanel;
```

FILE: apps/admin-web/src/features/compliance/compliance-audit-timeline.tsx

```tsx
// # NEW — Renders chronological compliance audit timeline
// # NEW — immutable audit timeline component
'use client';

import React from 'react';
import { Badge } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';

export interface ComplianceAuditTimelineEvent {
  id: string;
  eventType: string;
  actorId: string | null;
  decision?: string | null;
  rationale?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface ComplianceAuditTimelineProps {
  events: ComplianceAuditTimelineEvent[];
}

export function sortComplianceAuditEventsChronologically(
  events: ReadonlyArray<ComplianceAuditTimelineEvent>,
): ComplianceAuditTimelineEvent[] {
  return [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function ComplianceAuditTimeline({ events }: ComplianceAuditTimelineProps): JSX.Element {
  const sorted = sortComplianceAuditEventsChronologically(events);

  return (
    <div data-testid="compliance-audit-timeline" style={{ display: 'grid', gap: theme.space(3) }}>
      {sorted.length === 0 ? (
        <div style={{ fontSize: 13, color: theme.color.textMuted }}>
          No compliance audit events recorded yet.
        </div>
      ) : (
        <ol
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'grid',
            gap: theme.space(3),
          }}
        >
          {sorted.map((ev) => (
            <li
              key={ev.id}
              data-testid={`compliance-audit-event-${ev.id}`}
              style={{
                borderLeft: `3px solid ${theme.color.border}`,
                paddingLeft: theme.space(3),
                display: 'grid',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Badge tone="neutral">{ev.eventType}</Badge>
                {ev.decision && <Badge tone="info">{ev.decision}</Badge>}
                <span style={{ fontSize: 12, color: theme.color.textMuted }}>
                  {formatDateTime(ev.createdAt)} · Actor: <code>{ev.actorId ?? 'SYSTEM'}</code>
                </span>
              </div>
              {ev.rationale && (
                <div style={{ fontSize: 13 }}>
                  <strong>Rationale:</strong> {ev.rationale}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default ComplianceAuditTimeline;
```

FILE: apps/admin-web/src/features/compliance/compliance-case-detail.tsx

```tsx
// # NEW — Displays case evidence, screening hits, notes, and approve/reject/escalate actions
// # NEW — evidence, notes, decision, escalation UI
'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Card } from '@/components/ui';
import { apiClient } from '@/lib/api-client';
import { ApiError } from '@wlct/utils/api-error';
import { formatDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';
import { AmlScreeningPanel, type AmlScreeningMatch } from './aml-screening-panel';
import {
  ComplianceAuditTimeline,
  type ComplianceAuditTimelineEvent,
} from './compliance-audit-timeline';

export interface ComplianceCaseEvidenceItem {
  id: string;
  evidenceType: string;
  referenceId: string;
  referenceType: string;
  safeDescription: string;
  addedBy: string | null;
  createdAt: string;
}

export interface ComplianceCaseNoteItem {
  id: string;
  safeNote: string;
  authorId: string | null;
  createdAt: string;
}

export interface ComplianceCaseRecord {
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
  ruleIds?: string[];
  evidence?: ComplianceCaseEvidenceItem[];
  notes?: ComplianceCaseNoteItem[];
  screeningMatches?: AmlScreeningMatch[];
  auditEvents?: ComplianceAuditTimelineEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceCaseDetailProps {
  caseRecord: ComplianceCaseRecord;
}

export function validateComplianceDecisionRationale(rationale: string): {
  valid: boolean;
  error?: string;
} {
  if (!rationale || rationale.trim().length < 10) {
    return {
      valid: false,
      error: 'Compliance review decisions require a rationale of at least 10 characters.',
    };
  }
  return { valid: true };
}

export function ComplianceCaseDetail({ caseRecord }: ComplianceCaseDetailProps): JSX.Element {
  const router = useRouter();
  const [noteText, setNoteText] = useState<string>('');
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT' | 'HOLD' | 'ESCALATE'>('APPROVE');
  const [rationale, setRationale] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (noteText.trim().length < 5) return;
    setErrorMessage(null);
    setStatusMessage(null);
    startTransition(async () => {
      try {
        await apiClient.post(`/compliance/cases/${caseRecord.id}/notes`, {
          safeNote: noteText.trim(),
        });
        setNoteText('');
        setStatusMessage('Case note saved and audited.');
        router.refresh();
      } catch (err) {
        setErrorMessage(
          err instanceof ApiError ? err.message : (err as Error).message || 'Failed to add note.',
        );
      }
    });
  };

  const handleSubmitDecision = (e: React.FormEvent) => {
    e.preventDefault();
    if (rationale.trim().length < 10) return;
    setErrorMessage(null);
    setStatusMessage(null);
    startTransition(async () => {
      try {
        if (decision === 'ESCALATE') {
          await apiClient.post(`/compliance/cases/${caseRecord.id}/escalate`, {
            reason: rationale.trim(),
          });
        } else {
          await apiClient.post(`/compliance/cases/${caseRecord.id}/decision`, {
            decision,
            reason: rationale.trim(),
          });
        }
        setRationale('');
        setStatusMessage(`Case decision (${decision}) recorded with immutable audit entry.`);
        router.refresh();
      } catch (err) {
        setErrorMessage(
          err instanceof ApiError
            ? err.message
            : (err as Error).message || 'Failed to record case decision.',
        );
      }
    });
  };

  return (
    <div data-testid="compliance-case-detail" style={{ display: 'grid', gap: theme.space(5) }}>
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

      <Card
        title={`Case ${caseRecord.id} · ${caseRecord.caseType}`}
        description={caseRecord.safeSummary}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: theme.space(3),
            fontSize: 13,
          }}
        >
          <div>
            <strong>Status:</strong> <Badge tone="info">{caseRecord.state}</Badge>
          </div>
          <div>
            <strong>Risk / Severity:</strong>{' '}
            <Badge tone="danger">
              {caseRecord.riskLevel} · {caseRecord.severity}
            </Badge>
          </div>
          <div>
            <strong>Subject User:</strong> <code>{caseRecord.userId}</code>
          </div>
          <div>
            <strong>Assigned Reviewer:</strong> {caseRecord.assignedTo ?? 'Unassigned'}
          </div>
          <div>
            <strong>Jurisdiction:</strong> {caseRecord.jurisdiction ?? 'GLOBAL'}
          </div>
          <div>
            <strong>Opened:</strong> {formatDateTime(caseRecord.createdAt)}
          </div>
        </div>
      </Card>

      {/* AML / Sanctions Screening Panel */}
      <AmlScreeningPanel
        userId={caseRecord.userId}
        providerReference={`case-${caseRecord.id}`}
        screeningStatus={caseRecord.state}
        matches={caseRecord.screeningMatches ?? []}
      />

      {/* Evidence & Notes */}
      <Card
        title="Case Evidence & Reviewer Notes"
        description="PII-safe case evidence links and reviewer annotations."
      >
        <div style={{ display: 'grid', gap: theme.space(4) }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Evidence Items</div>
            {(caseRecord.evidence ?? []).length === 0 ? (
              <div style={{ fontSize: 12, color: theme.color.textMuted }}>
                No external evidence attachments linked yet.
              </div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {(caseRecord.evidence ?? []).map((ev) => (
                  <li key={ev.id}>
                    <strong>{ev.evidenceType}</strong> ({ev.referenceType}:{ev.referenceId}) —{' '}
                    {ev.safeDescription}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Reviewer Notes</div>
            {(caseRecord.notes ?? []).length === 0 ? (
              <div style={{ fontSize: 12, color: theme.color.textMuted }}>
                No reviewer notes recorded yet.
              </div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {(caseRecord.notes ?? []).map((n) => (
                  <li key={n.id}>
                    {n.safeNote} — <em>{n.authorId ?? 'Reviewer'}</em> ({formatDateTime(n.createdAt)})
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={handleAddNote} style={{ display: 'flex', gap: 8 }}>
            <input
              aria-label="Add case note"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add PII-safe reviewer note (min 5 chars)..."
              style={{ flex: 1, fontSize: 12, padding: '6px 8px' }}
            />
            <button
              type="submit"
              disabled={pending || noteText.trim().length < 5}
              style={{ fontSize: 12, padding: '6px 12px' }}
            >
              Add Note
            </button>
          </form>
        </div>
      </Card>

      {/* Approve / Reject / Hold / Escalate Decision Form */}
      <Card
        title="Compliance Review Decision"
        description="Every compliance decision requires a mandatory rationale and writes an immutable audit event."
      >
        <form
          onSubmit={handleSubmitDecision}
          data-testid="compliance-decision-form"
          style={{ display: 'grid', gap: theme.space(3) }}
        >
          <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12 }}>
              Decision Action:{' '}
              <select
                aria-label="Decision action"
                value={decision}
                onChange={(e) =>
                  setDecision(e.target.value as 'APPROVE' | 'REJECT' | 'HOLD' | 'ESCALATE')
                }
                style={{ fontSize: 12, padding: '6px 8px', marginLeft: 6 }}
              >
                <option value="APPROVE">APPROVE (Clear Restrictions)</option>
                <option value="REJECT">REJECT (Enforce Account Block)</option>
                <option value="HOLD">HOLD (Freeze Withdrawals)</option>
                <option value="ESCALATE">ESCALATE (Senior MLRO Review)</option>
              </select>
            </label>
          </div>
          <label style={{ fontSize: 12 }}>
            Mandatory Rationale (min 10 chars)
            <textarea
              aria-label="Decision rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={3}
              placeholder="Document the regulatory and factual basis for this decision..."
              style={{ width: '100%', fontSize: 12, padding: '6px 8px', marginTop: 4 }}
            />
          </label>
          <div>
            <button
              type="submit"
              disabled={pending || rationale.trim().length < 10}
              style={{
                fontSize: 12,
                padding: '6px 14px',
                borderRadius: theme.radius.md,
                border: `1px solid ${theme.color.border}`,
                cursor: 'pointer',
              }}
            >
              {pending ? 'Recording…' : `Submit ${decision} Decision`}
            </button>
          </div>
        </form>
      </Card>

      {/* Chronological Compliance Audit Timeline */}
      <Card
        title="Compliance Audit Timeline"
        description="Chronological immutable audit log for this case."
      >
        <ComplianceAuditTimeline events={caseRecord.auditEvents ?? []} />
      </Card>
    </div>
  );
}

export default ComplianceCaseDetail;
```

FILE: apps/admin-web/src/features/compliance/compliance-case-queue.tsx

```tsx
// # NEW — Renders filterable compliance case queue by severity, status, and SLA
// # NEW — case list with filters
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

export function filterComplianceCases(
  cases: ReadonlyArray<ComplianceCaseQueueItem>,
  filters: { state?: string; severity?: string },
): ComplianceCaseQueueItem[] {
  return cases.filter((item) => {
    if (filters.state && filters.state !== 'ALL' && item.state !== filters.state) {
      return false;
    }
    if (
      filters.severity &&
      filters.severity !== 'ALL' &&
      item.riskLevel !== filters.severity &&
      item.severity !== filters.severity
    ) {
      return false;
    }
    return true;
  });
}

export function ComplianceCaseQueue({
  cases,
  initialStateFilter = 'ALL',
  initialSeverityFilter = 'ALL',
}: ComplianceCaseQueueProps): JSX.Element {
  const [stateFilter, setStateFilter] = useState<string>(initialStateFilter);
  const [severityFilter, setSeverityFilter] = useState<string>(initialSeverityFilter);

  const filtered = useMemo(() => {
    return filterComplianceCases(cases, { state: stateFilter, severity: severityFilter });
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

export default ComplianceCaseQueue;
```

FILE: apps/admin-web/src/features/execution/exchange-rate-limit-health.tsx

```tsx
// # Responsibility: shows each exchange account's rate-limit budget, remaining headroom, and pressure, and says plainly when the state is unavailable.
//
// Two things this panel must not do, both because it is the screen an operator checks when orders
// stop moving:
//
//   1. It must not render an unknown budget as a healthy one. `getRateLimitState` returns null when
//      the state cannot be read, and the routing decision refuses in that case - so the panel shows
//      UNKNOWN with the reason, not a bar at zero percent pressure. A dashboard that draws an empty
//      bar for "we could not read this" tells an operator the opposite of what is true.
//   2. It must not invent a limit. `remaining` is nullable server-side and `currentUsage` /
//      `pressure` are reported as measured; when the server withheld a number the cell says so.
'use client';

import React from 'react';
import { Badge, DataTable } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme, type StatusTone } from '@/lib/theme';

export interface ExchangeRateLimitRow {
  accountId: string | null;
  venue: string;
  environment: string;
  endpointClass: string;
  /** Null when the server could not establish the budget. Not the same as zero. */
  currentUsage: number | null;
  /** Null when the server withheld it. */
  remaining: number | null;
  /** 0-100 as measured. Null when unavailable, never defaulted to 0. */
  pressure: number | null;
  isWeightBased: boolean;
  requestsPerInterval: number | null;
  scope: string;
  retryAfterMs: number | null;
  resetAtMs: number | null;
  /** Populated when the state could not be read, so the operator sees why traffic stopped. */
  unavailableReason: string | null;
}

export interface ExchangeRateLimitHealthProps {
  rows: ExchangeRateLimitRow[];
}

/** The server's RateLimitState, as returned by GET /v1/exchanges/rate-limits/:accountId. */
export interface ServerRateLimitState {
  venue: string;
  environment: string;
  accountId: string | null;
  endpointClass: string;
  currentUsage: number;
  remaining: number | null;
  pressure: number;
  isWeightBased: boolean;
  requestsPerInterval: number;
  scope: string;
  retryAfterMs: number | null;
  resetAtMs: number | null;
}

const PRESSURE_WARNING = 70;
const PRESSURE_CRITICAL = 90;

/**
 * The pressure band, or null when the measurement is unavailable. Returning null rather than a
 * default band is the point: an unknown budget has no tone.
 */
export function pressureTone(pressure: number | null): StatusTone | null {
  if (pressure === null || !Number.isFinite(pressure)) return null;
  if (pressure >= PRESSURE_CRITICAL) return 'danger';
  if (pressure >= PRESSURE_WARNING) return 'warning';
  return 'neutral';
}

export function summarizeRateLimitHealth(rows: ReadonlyArray<ExchangeRateLimitRow>): {
  total: number;
  unavailable: number;
  atOrAboveWarning: number;
  worstPressure: number | null;
} {
  let unavailable = 0;
  let atOrAboveWarning = 0;
  let worst: number | null = null;
  for (const row of rows) {
    if (row.pressure === null) {
      unavailable += 1;
      continue;
    }
    if (row.pressure >= PRESSURE_WARNING) atOrAboveWarning += 1;
    worst = worst === null ? row.pressure : Math.max(worst, row.pressure);
  }
  return { total: rows.length, unavailable, atOrAboveWarning, worstPressure: worst };
}

/**
 * Maps the server's state onto a row. A null state becomes an explicit unavailable row rather than
 * a dropped account: an account missing from the panel reads as "not monitored", which is a
 * different and false claim.
 */
export function toRateLimitRow(
  accountId: string | null,
  state: ServerRateLimitState | null,
  fallback: { venue: string; endpointClass: string },
): ExchangeRateLimitRow {
  if (!state) {
    return {
      accountId,
      venue: fallback.venue,
      environment: 'UNKNOWN',
      endpointClass: fallback.endpointClass,
      currentUsage: null,
      remaining: null,
      pressure: null,
      isWeightBased: false,
      requestsPerInterval: null,
      scope: 'UNKNOWN',
      retryAfterMs: null,
      resetAtMs: null,
      unavailableReason: 'The exchange rate-limit state could not be read.',
    };
  }

  return {
    accountId: state.accountId ?? accountId,
    venue: state.venue,
    environment: state.environment,
    endpointClass: state.endpointClass,
    currentUsage: state.currentUsage,
    remaining: state.remaining,
    pressure: state.pressure,
    isWeightBased: state.isWeightBased,
    requestsPerInterval: state.requestsPerInterval,
    scope: state.scope,
    retryAfterMs: state.retryAfterMs,
    resetAtMs: state.resetAtMs,
    unavailableReason: null,
  };
}

function panelStyle(): React.CSSProperties {
  return {
    border: `1px solid ${theme.color.border}`,
    borderRadius: theme.radius.md,
    padding: theme.space(4),
    display: 'grid',
    gap: theme.space(3),
    background: theme.color.surface,
  };
}

export function ExchangeRateLimitHealth({ rows }: ExchangeRateLimitHealthProps): JSX.Element {
  const summary = summarizeRateLimitHealth(rows);
  const muted = { fontSize: 12, color: theme.color.textMuted };
  const unavailableRows = rows.filter((row) => row.unavailableReason);

  return (
    <section style={panelStyle()} aria-label="Exchange rate-limit health" data-testid="exchange-rate-limit-health">
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(2) }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Exchange rate-limit budget</h2>
          <p style={{ ...muted, margin: '4px 0 0' }}>
            Per account and endpoint class over the current minute window. {summary.total} account
            {summary.total === 1 ? '' : 's'} monitored
            {summary.unavailable > 0
              ? `, ${summary.unavailable} with an unreadable budget - routing refuses for those accounts rather than risk a venue ban`
              : ''}
            {summary.atOrAboveWarning > 0 ? `, ${summary.atOrAboveWarning} at or above ${PRESSURE_WARNING}% pressure` : ''}
            .
          </p>
        </div>
        {summary.unavailable > 0 ? <Badge tone="danger">BUDGET UNKNOWN</Badge> : null}
      </header>

      <DataTable<ExchangeRateLimitRow>
        rows={rows}
        rowKey={(row) => `${row.accountId ?? 'global'}:${row.venue}:${row.environment}:${row.endpointClass}`}
        emptyTitle="No exchange accounts are being monitored"
        emptyDescription="This tenant has no exchange accounts reporting a rate-limit budget."
        columns={[
          {
            key: 'account',
            header: 'Account',
            render: (row) => <code style={{ fontSize: 12 }}>{row.accountId ?? 'global'}</code>,
          },
          {
            key: 'venue',
            header: 'Venue',
            render: (row) => (
              <span style={{ fontSize: 12 }}>
                {row.venue} <span style={{ color: theme.color.textMuted }}>({row.environment})</span>
              </span>
            ),
          },
          {
            key: 'endpoint',
            header: 'Endpoint Class',
            render: (row) => (
              <span style={{ fontSize: 12 }}>
                {row.endpointClass}
                {row.isWeightBased ? ' · weighted' : ''}
              </span>
            ),
          },
          {
            key: 'usage',
            header: 'Used / limit',
            render: (row) =>
              row.pressure === null ? (
                <span style={{ fontSize: 12, color: theme.color.danger }}>UNKNOWN</span>
              ) : (
                <span style={{ fontSize: 12 }}>
                  {row.currentUsage} /{' '}
                  {row.requestsPerInterval === null
                    ? 'UNKNOWN'
                    : `${row.requestsPerInterval}${row.isWeightBased ? ' weight/min' : ' req/s'}`}
                </span>
              ),
          },
          {
            key: 'remaining',
            header: 'Remaining',
            render: (row) => (
              <span style={{ fontSize: 12 }}>
                {row.remaining === null ? 'UNKNOWN' : row.remaining}
              </span>
            ),
          },
          {
            key: 'pressure',
            header: 'Pressure',
            // UNKNOWN rather than a zero-width bar: a budget nobody could read is not an empty one.
            render: (row) =>
              row.pressure === null ? (
                <Badge tone="danger">UNKNOWN</Badge>
              ) : (
                <Badge tone={pressureTone(row.pressure) ?? 'neutral'}>{row.pressure}%</Badge>
              ),
          },
          {
            key: 'retry',
            header: 'Retry After',
            render: (row) => <span style={{ fontSize: 12 }}>{row.retryAfterMs === null ? '—' : `${row.retryAfterMs} ms`}</span>,
          },
          {
            key: 'reset',
            header: 'Window Resets',
            render: (row) => (
              <span style={{ fontSize: 12 }}>
                {row.resetAtMs === null ? 'UNKNOWN' : formatDateTime(new Date(row.resetAtMs).toISOString())}
              </span>
            ),
          },
        ]}
      />

      {unavailableRows.length > 0 ? (
        <ul style={{ ...muted, color: theme.color.danger, margin: 0, paddingLeft: theme.space(4) }} data-testid="rate-limit-unavailable-reasons">
          {unavailableRows.map((row) => (
            <li key={`${row.accountId ?? 'global'}:${row.venue}:${row.endpointClass}`}>
              {row.venue} {row.endpointClass} ({row.accountId ?? 'global'}): {row.unavailableReason}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
```

FILE: apps/admin-web/src/features/execution/execution-incident-table.tsx

```tsx
// # NEW — Displays execution incidents, venue outages, and manual resolution actions
// # NEW — incidents table/detail UI
'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, DataTable } from '@/components/ui';
import { apiClient } from '@/lib/api-client';
import { ApiError } from '@wlct/utils/api-error';
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

export function summarizeExecutionIncidents(incidents: ReadonlyArray<ExecutionIncidentRow>): {
  openCount: number;
  criticalCount: number;
  resolvedCount: number;
} {
  let openCount = 0;
  let criticalCount = 0;
  let resolvedCount = 0;
  for (const inc of incidents) {
    if (inc.resolvedAt) {
      resolvedCount++;
    } else {
      openCount++;
      if (inc.severity === 'CRITICAL') {
        criticalCount++;
      }
    }
  }
  return { openCount, criticalCount, resolvedCount };
}

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

export default ExecutionIncidentTable;
```

FILE: apps/admin-web/src/features/funding/funding-reconciliation-table.tsx

```tsx
// # NEW — Displays balance/settlement discrepancies and resolution controls
// # NEW — reconciliation findings and actions
'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, DataTable } from '@/components/ui';
import { apiClient } from '@/lib/api-client';
import { ApiError } from '@wlct/utils/api-error';
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

export function summarizeFundingReconciliationFindings(
  findings: ReadonlyArray<CustodyReconciliationFindingRow>,
): { unresolvedCount: number; criticalCount: number; resolvedCount: number } {
  let unresolvedCount = 0;
  let criticalCount = 0;
  let resolvedCount = 0;
  for (const row of findings) {
    if (row.resolved) {
      resolvedCount++;
    } else {
      unresolvedCount++;
      if (row.severity === 'CRITICAL' || row.severity === 'HIGH') {
        criticalCount++;
      }
    }
  }
  return { unresolvedCount, criticalCount, resolvedCount };
}

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

export default FundingReconciliationTable;
```

FILE: apps/admin-web/src/features/partners/partner-admin-table.tsx

```tsx
// # NEW — Renders partner list, tier override controls, and payout approval actions
// # NEW — partner list, agreements, settlements, payouts, reconciliation UI
'use client';

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
```

FILE: apps/admin-web/src/features/trading/lead-trader-application-queue.tsx

```tsx
// # Responsibility: lets tenant-authorized operators inspect declarations, claim applications, and record auditable decisions.
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui';
import { ApiError } from '@wlct/utils/api-error';
import { apiClient } from '@/lib/api-client';
import { theme } from '@/lib/theme';

export type AdminApplicationStatus = 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

export interface AdminLeadTraderApplication {
  id: string;
  traderId: string;
  applicantUserId: string | null;
  reviewerUserId: string | null;
  status: AdminApplicationStatus;
  version: number;
  declaration: {
    yearsExperience?: number;
    markets?: string[];
    strategySummary?: string;
    evidenceReferences?: string[];
    riskAcknowledged?: boolean;
  };
  submittedAt: string;
  reviewedAt: string | null;
  decisionReason: string | null;
}

interface QueueResponse {
  data: AdminLeadTraderApplication[];
  total: number;
  page: number;
  limit: number;
}

const STATUS_TONES: Record<AdminApplicationStatus, 'warning' | 'info' | 'success' | 'danger'> = {
  SUBMITTED: 'warning',
  IN_REVIEW: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
};

function parseQueueResponse(input: unknown): QueueResponse {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Application queue returned an invalid response.');
  }
  const root = input as Record<string, unknown>;
  if (!Array.isArray(root.data)) throw new Error('Application queue did not contain a data list.');
  const rows = root.data.filter((entry): entry is Record<string, unknown> =>
    Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
  const data: AdminLeadTraderApplication[] = rows.map((row) => {
    const declaration = row.declaration && typeof row.declaration === 'object' && !Array.isArray(row.declaration)
      ? row.declaration as AdminLeadTraderApplication['declaration']
      : {};
    const status = row.status;
    if (status !== 'SUBMITTED' && status !== 'IN_REVIEW' && status !== 'APPROVED' && status !== 'REJECTED') {
      throw new Error('Application queue returned an unknown review status.');
    }
    if (typeof row.id !== 'string' || typeof row.traderId !== 'string' || typeof row.submittedAt !== 'string') {
      throw new Error('Application queue row is missing its tenant-scoped identifiers.');
    }
    return {
      id: row.id,
      traderId: row.traderId,
      applicantUserId: typeof row.applicantUserId === 'string' ? row.applicantUserId : null,
      reviewerUserId: typeof row.reviewerUserId === 'string' ? row.reviewerUserId : null,
      status,
      version: typeof row.version === 'number' ? row.version : 1,
      declaration,
      submittedAt: row.submittedAt,
      reviewedAt: typeof row.reviewedAt === 'string' ? row.reviewedAt : null,
      decisionReason: typeof row.decisionReason === 'string' ? row.decisionReason : null,
    };
  });
  return {
    data,
    total: typeof root.total === 'number' ? root.total : data.length,
    page: typeof root.page === 'number' ? root.page : 1,
    limit: typeof root.limit === 'number' ? root.limit : data.length,
  };
}

export function LeadTraderApplicationQueue({ initialQueue }: { initialQueue: QueueResponse }): JSX.Element {
  const [queue, setQueue] = useState(initialQueue);
  const [filter, setFilter] = useState<AdminApplicationStatus | 'ACTIVE'>('ACTIVE');
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [pendingApplicationId, setPendingApplicationId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    const params = filter === 'ACTIVE' ? {} : { status: filter };
    const raw = await apiClient.get<unknown>('/copy-trading/lead-trader-applications/admin', {
      searchParams: { ...params, page: 1, limit: 50 },
    });
    setQueue(parseQueueResponse(raw));
  }, [filter]);

  useEffect(() => {
    let active = true;
    void apiClient.get<unknown>('/copy-trading/lead-trader-applications/admin', {
      searchParams: { ...(filter === 'ACTIVE' ? {} : { status: filter }), page: 1, limit: 50 },
    }).then((raw) => {
      if (active) setQueue(parseQueueResponse(raw));
    }).catch((error: unknown) => {
      if (active) setErrorMessage(error instanceof ApiError ? error.message : 'Could not refresh the application queue.');
    });
    return () => { active = false; };
  }, [filter]);

  const runAction = async (applicationId: string, action: 'claim' | 'approve' | 'reject') => {
    setPendingApplicationId(applicationId);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      if (action === 'claim') {
        await apiClient.post(`/copy-trading/lead-trader-applications/${encodeURIComponent(applicationId)}/start-review`);
        setStatusMessage('Application claimed for review.');
      } else {
        const reason = decisionReasons[applicationId]?.trim() ?? '';
        if (action === 'reject' && reason.length < 20) {
          setErrorMessage('A rejection reason of at least 20 characters is required.');
          return;
        }
        await apiClient.post(`/copy-trading/lead-trader-applications/${encodeURIComponent(applicationId)}/decision`, {
          decision: action === 'approve' ? 'APPROVE' : 'REJECT',
          ...(reason ? { decisionReason: reason } : {}),
        });
        setStatusMessage(`Application ${action === 'approve' ? 'approved' : 'rejected'}; the decision has been recorded.`);
      }
      await loadQueue();
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'The application action failed. Verify your tenant role and current review assignment.');
    } finally {
      setPendingApplicationId(null);
    }
  };

  const rows = queue.data;
  return (
    <div data-testid="lead-trader-application-queue" style={{ display: 'grid', gap: theme.space(4) }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(3) }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: theme.space(2), fontSize: 13 }}>
          Application status
          <select aria-label="Filter application status" value={filter} onChange={(event) => setFilter(event.target.value as AdminApplicationStatus | 'ACTIVE')} style={{ padding: '6px 8px' }}>
            <option value="ACTIVE">Active review queue</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="IN_REVIEW">In review</option>
            <option value="APPROVED">Approved history</option>
            <option value="REJECTED">Rejected history</option>
          </select>
        </label>
        <span style={{ color: theme.color.textMuted, fontSize: 12 }}>{queue.total} application{queue.total === 1 ? '' : 's'} in this result</span>
      </div>

      {errorMessage && <p role="alert" style={{ margin: 0, color: 'var(--wlct-color-danger)', fontSize: 13 }}>{errorMessage}</p>}
      {statusMessage && <p role="status" style={{ margin: 0, fontSize: 13 }}>{statusMessage}</p>}

      {rows.length === 0 ? (
        <div style={{ border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.md, padding: theme.space(6), color: theme.color.textMuted, fontSize: 13 }}>
          No applications match this status. Queue counts reflect persisted application records only.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: theme.space(3) }}>
          {rows.map((application) => {
            const declaration = application.declaration;
            const isPending = pendingApplicationId === application.id;
            return (
              <article key={application.id} style={{ border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.md, padding: theme.space(4), display: 'grid', gap: theme.space(3) }}>
                <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(3) }}>
                  <div>
                    <strong>Application version {application.version}</strong>
                    <div style={{ color: theme.color.textMuted, fontSize: 11, marginTop: 3 }}>Trader {application.traderId} · Applicant {application.applicantUserId ?? 'deleted account'} · Submitted {new Date(application.submittedAt).toLocaleString()}</div>
                  </div>
                  <Badge tone={STATUS_TONES[application.status]}>{application.status.replace('_', ' ')}</Badge>
                </header>

                <dl style={{ margin: 0, display: 'grid', gap: theme.space(2), fontSize: 13 }}>
                  <div><dt style={{ color: theme.color.textMuted }}>Experience / markets</dt><dd style={{ margin: '3px 0 0' }}>{declaration.yearsExperience ?? 'Not stated'} years · {(declaration.markets ?? []).join(', ') || 'No market selected'}</dd></div>
                  <div><dt style={{ color: theme.color.textMuted }}>Strategy and risk summary</dt><dd style={{ margin: '3px 0 0', whiteSpace: 'pre-wrap' }}>{declaration.strategySummary ?? 'No summary supplied'}</dd></div>
                  <div><dt style={{ color: theme.color.textMuted }}>Evidence reference IDs</dt><dd style={{ margin: '3px 0 0' }}>{(declaration.evidenceReferences ?? []).join(', ') || 'None supplied'} · IDs are not verification evidence by themselves.</dd></div>
                  <div><dt style={{ color: theme.color.textMuted }}>Risk disclosure</dt><dd style={{ margin: '3px 0 0' }}>{declaration.riskAcknowledged === true ? 'Acknowledged' : 'Not acknowledged'}</dd></div>
                </dl>

                {application.decisionReason && <p style={{ margin: 0, fontSize: 13 }}><strong>Recorded decision reason: </strong>{application.decisionReason}</p>}
                {application.status === 'SUBMITTED' && (
                  <button type="button" disabled={isPending || pendingApplicationId !== null} onClick={() => void runAction(application.id, 'claim')} style={{ width: 'fit-content', padding: '7px 12px' }}>
                    {isPending ? 'Claiming…' : 'Claim for review'}
                  </button>
                )}
                {application.status === 'IN_REVIEW' && (
                  <div style={{ display: 'grid', gap: theme.space(2) }}>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                      Decision reason (required for rejection; 20–1000 characters)
                      <textarea maxLength={1000} rows={3} value={decisionReasons[application.id] ?? ''} onChange={(event) => setDecisionReasons((current) => ({ ...current, [application.id]: event.target.value }))} />
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.space(2) }}>
                      <button type="button" disabled={isPending || pendingApplicationId !== null} onClick={() => void runAction(application.id, 'approve')} style={{ padding: '7px 12px' }}>Approve</button>
                      <button type="button" disabled={isPending || pendingApplicationId !== null} onClick={() => void runAction(application.id, 'reject')} style={{ padding: '7px 12px' }}>Reject</button>
                    </div>
                    {application.reviewerUserId && <p style={{ margin: 0, color: theme.color.textMuted, fontSize: 11 }}>Claimed by reviewer {application.reviewerUserId}; only the claimant can decide this application.</p>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

FILE: apps/admin-web/src/lib/api-client.ts

```typescript
'use client';

import { ApiError } from '@wlct/utils/api-error';

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

FILE: apps/admin-web/src/lib/console-claims.ts

```typescript
import { decodeAccessTokenClaims, getAccessToken } from '@/lib/session';

/**
 * Server-side view of the session claims for page rendering (round 7).
 *
 * Exactly like the sidebar, this is a usability filter: it decides which
 * notices and buttons a page renders. It is NOT access control - the API
 * re-authorises every request these pages make and is the only authority.
 */
export interface ConsoleClaims {
  userId: string;
  tenantId: string;
  permissions: string[];
  isPlatformUser: boolean;
}

export function getConsoleClaims(): ConsoleClaims | null {
  const token = getAccessToken();
  if (!token) {
    return null;
  }
  const claims = decodeAccessTokenClaims(token);
  if (!claims) {
    return null;
  }
  return { userId: claims.sub, tenantId: claims.tid, permissions: claims.perms, isPlatformUser: claims.plat };
}

/** Same matching rule as the sidebar: exact permission, `resource:*`, or `*`. */
export function hasPermission(claims: ConsoleClaims | null, permission: string): boolean {
  if (!claims) {
    return false;
  }
  const granted = new Set(claims.permissions);
  if (granted.has('*') || granted.has(permission)) {
    return true;
  }
  const [resource] = permission.split(':');
  return granted.has(`${resource}:*`);
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

import { ApiError } from '@wlct/utils/api-error';
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

FILE: apps/admin-web/src/modules/billing/billing-scope.tsx

```tsx
import type { ReactNode } from 'react';

import '@/styles/billing-utilities.css';

/**
 * Wraps the billing screens (portal, plan catalogue, SaaS tenant admin) in the
 * `.wlct-billing` scope. Those components were written with utility class
 * names; billing-utilities.css defines exactly those classes, mapped onto the
 * console's dark theme tokens and scoped to this wrapper so nothing leaks
 * into the rest of the console.
 */
export function BillingScope({ children }: { children: ReactNode }): JSX.Element {
  return <div className="wlct-billing">{children}</div>;
}
```

FILE: apps/admin-web/src/modules/billing/entitlements/entitlement-api.ts

```typescript
/**
 * Entitlement API for Admin Web
 *
 * Read-only access to the API's entitlement DERIVATION (plan features, plan
 * limits, feature flags), through the console's same-origin proxy
 * (/api/proxy/* -> API_BASE_URL/v1/*). apiClient unwraps {success, data}.
 *
 * Platform operators (platform:manage), any tenant:
 *   GET /v1/billing/saas-admin/tenants/:id/feature-access
 *   GET /v1/billing/saas-admin/tenants/:id/feature-access/:featureKey
 * The caller's own tenant (subscription:read):
 *   GET /v1/billing/subscription/limits
 *   GET /v1/billing/portal/usage
 *
 * Entitlements change only by changing the tenant's plan (billing portal or
 * SaaS admin plan routes) or its feature flags; there is deliberately no
 * entitlement write API. Before round 7 this module fetched
 * `/api/billing/entitlements/*` on the admin origin (no such route) and
 * offered create/suspend/cancel/reset-usage calls the API never had.
 */

import { apiClient } from '@/lib/api-client';

import type { FeatureCheckResult, OwnPlanLimits, OwnUsageSummary, TenantFeatureAccess } from './entitlement-types';

export async function getTenantFeatureAccess(tenantId: string): Promise<TenantFeatureAccess> {
  return apiClient.get<TenantFeatureAccess>(`/billing/saas-admin/tenants/${encodeURIComponent(tenantId)}/feature-access`);
}

export async function checkTenantFeature(tenantId: string, featureKey: string): Promise<FeatureCheckResult> {
  return apiClient.get<FeatureCheckResult>(
    `/billing/saas-admin/tenants/${encodeURIComponent(tenantId)}/feature-access/${encodeURIComponent(featureKey)}`,
  );
}

export async function getOwnPlanLimits(): Promise<OwnPlanLimits> {
  return apiClient.get<OwnPlanLimits>('/billing/subscription/limits');
}

export async function getOwnUsage(): Promise<OwnUsageSummary> {
  return apiClient.get<OwnUsageSummary>('/billing/portal/usage');
}
```

FILE: apps/admin-web/src/modules/billing/entitlements/entitlement-types.ts

```typescript
/**
 * Entitlement Types for Admin Web
 *
 * In this platform an entitlement is not a stored record: it is DERIVED from
 * the tenant's subscription plan (its `features` array and `limits`), plus
 * feature flags, by the API's TenantFeatureAccessService. These types mirror
 * what the API returns for that derivation. The earlier version of this module
 * described entitlement CRUD (create/suspend/reset usage/...) that the API has
 * never had; it was removed in round 7.
 */

import type { PlanLimits } from '@wlct/shared-types';

/** Where an effective feature decision came from (SaasEntitlementSummary.source). */
export type EntitlementSource = 'plan_features' | 'plan_limits_boolean' | 'feature_flag' | 'none';

/** One effective feature of a tenant (SaasEntitlementSummary). */
export interface TenantEntitlement {
  featureKey: string;
  enabled: boolean;
  source: EntitlementSource;
  planCode: string | null;
  subscriptionStatus: string | null;
  reason: string | null;
}

/** One effective limit of a tenant with its current usage (SaasLimitSummary). */
export interface TenantLimit {
  limitKey: string;
  configuredLimit: number | null;
  currentUsage: number;
  remaining: number | null;
  unlimited: boolean;
  percentageUsed: number | null;
  source: 'plan_limits' | 'tenant_override' | 'none';
}

/** GET /v1/billing/saas-admin/tenants/:id/feature-access */
export interface TenantFeatureAccess {
  tenantId: string;
  features: TenantEntitlement[];
  limits: TenantLimit[];
  fetchedAt: string;
}

/** GET /v1/billing/saas-admin/tenants/:id/feature-access/:featureKey */
export interface FeatureCheckResult {
  tenantId: string;
  featureKey: string;
  allowed: boolean;
  reason: string | null;
  planCode: string | null;
  subscriptionStatus: string | null;
  source: EntitlementSource;
}

/** GET /v1/billing/subscription/limits - the caller's own plan limits (null without a subscription). */
export type OwnPlanLimits = PlanLimits | null;

/** One usage line of GET /v1/billing/portal/usage (PortalUsageItem). */
export interface UsageItem {
  key: string;
  label: string;
  current: number;
  limit: number | null;
  remaining: number | null;
  unlimited: boolean;
  percentageUsed: number | null;
  scope: string;
}

/** One feature line of GET /v1/billing/portal/usage (PortalFeatureAvailability). */
export interface FeatureAvailability {
  key: string;
  label: string;
  included: boolean;
  source: 'features_array' | 'limits_boolean' | 'none';
}

/** GET /v1/billing/portal/usage - the caller's own usage against its plan. */
export interface OwnUsageSummary {
  tenantId: string;
  items: UsageItem[];
  features: FeatureAvailability[];
  fetchedAt: string;
}
```

FILE: apps/admin-web/src/modules/billing/entitlements/index.ts

```typescript
/**
 * Entitlements Module - Admin Web Public API
 *
 * Read-only views of the API's entitlement derivation (see entitlement-api.ts).
 */

// Types
export type {
  EntitlementSource,
  TenantEntitlement,
  TenantLimit,
  TenantFeatureAccess,
  FeatureCheckResult,
  OwnPlanLimits,
  UsageItem,
  FeatureAvailability,
  OwnUsageSummary,
} from './entitlement-types';

// API
export { getTenantFeatureAccess, checkTenantFeature, getOwnPlanLimits, getOwnUsage } from './entitlement-api';
```

FILE: apps/admin-web/src/modules/billing/entitlements/own-plan-limits-panel.tsx

```tsx
'use client';

import React, { useEffect, useState } from 'react';

import { LIMIT_LABELS } from '../plans/plan-formatters';
import type { PlanLimits } from '../plans/plan-types';

import { getOwnPlanLimits } from './entitlement-api';
import type { OwnPlanLimits } from './entitlement-types';

/**
 * The caller's own plan limits (round 7), from GET /v1/billing/subscription/limits:
 * exactly what the API enforces for this organisation. No subscription means
 * no limits object, which is shown as such rather than as defaults.
 */
export default function OwnPlanLimitsPanel() {
  const [limits, setLimits] = useState<OwnPlanLimits | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOwnPlanLimits()
      .then((value) => setLimits(value ?? null))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load plan limits'));
  }, []);

  return (
    <div className="p-6">
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Plan limits enforced by the platform</h2>
        {error ? (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">{error}</div>
        ) : limits === undefined ? (
          <div className="animate-pulse h-32 bg-gray-200 rounded" />
        ) : limits === null ? (
          <p className="text-sm text-gray-500">No active subscription, so no plan limits apply yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            {(Object.keys(LIMIT_LABELS) as Array<keyof PlanLimits>).map((key) => {
              const value = limits[key];
              return (
                <div key={key} className="flex justify-between border-b py-1">
                  <span className="text-gray-500">{LIMIT_LABELS[key]}</span>
                  <span className="font-medium">
                    {typeof value === 'boolean' ? (value ? 'Included' : 'Not included') : value === null || value === undefined ? 'Unlimited' : value.toLocaleString('en-US')}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

FILE: apps/admin-web/src/modules/billing/entitlements/tenant-entitlements-panel.tsx

```tsx
'use client';

import React, { useEffect, useState } from 'react';

import { ApiError } from '@wlct/utils/api-error';

import { checkTenantFeature, getTenantFeatureAccess } from './entitlement-api';
import type { FeatureCheckResult, TenantFeatureAccess } from './entitlement-types';

/**
 * Platform operator view of ONE tenant's effective entitlements (round 7):
 * the features and limits the API derives from the tenant's plan and feature
 * flags, with current usage, plus a single-feature check that returns the
 * API's own decision and reason. Read-only: entitlements change only through
 * the tenant's plan (see the plan panel on the same page) or feature flags.
 */
export default function TenantEntitlementsPanel({ tenantId }: { tenantId: string }) {
  const [access, setAccess] = useState<TenantFeatureAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featureKey, setFeatureKey] = useState('');
  const [check, setCheck] = useState<FeatureCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setAccess(await getTenantFeatureAccess(tenantId));
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Failed to load entitlements');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const runCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = featureKey.trim();
    if (!key) return;
    setChecking(true);
    setCheck(null);
    setCheckError(null);
    try {
      setCheck(await checkTenantFeature(tenantId, key));
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Check failed');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="bg-white border rounded-lg p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Effective entitlements</h2>
        <button onClick={load} className="text-sm text-gray-600 hover:text-gray-900">
          Refresh
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Derived by the API from the tenant&apos;s plan and feature flags. Change the plan to change them.
      </p>

      {loading ? (
        <div className="animate-pulse h-32 bg-gray-200 rounded" />
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">{error}</div>
      ) : access ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium text-sm mb-2">Features</h3>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {access.features.length === 0 && <p className="text-xs text-gray-500">No features</p>}
              {access.features.map((f) => (
                <div key={f.featureKey} className="flex justify-between text-xs border-b py-1">
                  <span>
                    {f.featureKey}
                    <span className="text-gray-400 ml-1">({f.source})</span>
                  </span>
                  <span className={f.enabled ? 'text-green-600' : 'text-gray-400'}>{f.enabled ? 'Enabled' : f.reason || 'Disabled'}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="font-medium text-sm mb-2">Limits and usage</h3>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {access.limits.length === 0 && <p className="text-xs text-gray-500">No limits</p>}
              {access.limits.map((l) => (
                <div key={l.limitKey} className="text-xs border-b py-1">
                  <div className="flex justify-between">
                    <span>{l.limitKey}</span>
                    <span>{l.unlimited ? 'Unlimited' : `${l.currentUsage} / ${l.configuredLimit ?? '-'} (${l.remaining ?? 0} left)`}</span>
                  </div>
                  {!l.unlimited && l.percentageUsed !== null && (
                    <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${Math.min(100, Math.max(0, l.percentageUsed))}%` }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <form onSubmit={runCheck} className="flex gap-2">
        <input
          type="text"
          placeholder="Check a feature key, e.g. custom_domain"
          value={featureKey}
          onChange={(e) => setFeatureKey(e.target.value)}
          className="flex-1 border rounded px-3 py-2 text-sm"
        />
        <button type="submit" disabled={checking || !featureKey.trim()} className="px-4 py-2 bg-gray-800 text-white rounded text-sm disabled:opacity-50">
          {checking ? 'Checking...' : 'Check'}
        </button>
      </form>
      {checkError && <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">{checkError}</div>}
      {check && (
        <div className={`border rounded p-3 text-sm ${check.allowed ? 'bg-green-100' : 'bg-yellow-50'}`}>
          <p className="font-medium">
            {check.featureKey}: {check.allowed ? 'allowed' : 'not allowed'}
          </p>
          <p className="text-xs text-gray-600 mt-1">
            Source {check.source}; plan {check.planCode ?? 'none'}; subscription {check.subscriptionStatus ?? 'none'}
            {check.reason ? `; ${check.reason}` : ''}
          </p>
        </div>
      )}
    </div>
  );
}
```

FILE: apps/admin-web/src/modules/billing/plans/index.ts

```typescript
/**
 * Plans Module - Admin Web Public API
 *
 * Types, API calls and formatters for the plan catalogue. Every call maps to
 * a route of /v1/billing/plans (see plan-api.ts).
 */

// Runtime values (value re-exports under isolatedModules)
export { PlanStatus, BILLING_INTERVALS, PLAN_AUDIENCES, PLAN_CURRENCIES, planStatus } from './plan-types';

// Types
export type {
  Plan,
  PlanLimits,
  BillingInterval,
  PlanAudience,
  PlanCurrency,
  PlanFilter,
  PlanPage,
  CreatePlanRequest,
  UpdatePlanRequest,
  ArchivePlanResult,
} from './plan-types';

// API
export {
  getPlans,
  getPlan,
  createPlan,
  updatePlan,
  activatePlan,
  deactivatePlan,
  archivePlan,
} from './plan-api';

// Formatters
export {
  LIMIT_LABELS,
  formatPrice,
  formatInterval,
  formatAudience,
  formatStatus,
  getStatusColor,
  formatBps,
  formatLimit,
  formatPlanSummary,
  formatPlanComparison,
} from './plan-formatters';
```

FILE: apps/admin-web/src/modules/billing/plans/plan-api.ts

```typescript
/**
 * Plan API for Admin Web
 *
 * The plan catalogue routes of the platform API, called through the console's
 * same-origin proxy (/api/proxy/* -> API_BASE_URL/v1/*), which holds the
 * bearer token in an httpOnly cookie and adds the CSRF header to mutations.
 * apiClient unwraps the {success, data} envelope.
 *
 *   GET    /v1/billing/plans        plan:read    paginated catalogue
 *   GET    /v1/billing/plans/:id    plan:read
 *   POST   /v1/billing/plans        plan:manage  create
 *   PATCH  /v1/billing/plans/:id    plan:manage  update (incl. isActive)
 *   DELETE /v1/billing/plans/:id    plan:manage  archive (refused while the
 *                                                plan has live subscribers)
 *
 * Before round 7 this module fetched `/api/billing/plans` on the admin origin
 * (no such route - every call 404'd), used PUT where the API has PATCH, and
 * offered duplicate / stats / history calls for which the API has no route.
 * Those were removed instead of being pointed at invented endpoints.
 * Activation is the real `isActive` field of PATCH.
 */

import { apiClient } from '@/lib/api-client';

import type {
  ArchivePlanResult,
  CreatePlanRequest,
  Plan,
  PlanFilter,
  PlanPage,
  UpdatePlanRequest,
} from './plan-types';

/** Only the query keys ListPlansDto declares are sent (others are a 422). */
export async function getPlans(filter?: PlanFilter): Promise<PlanPage> {
  // The keys are written out literally (no helper) so that
  // scripts/check-web-api-contract.js can verify each against ListPlansDto.
  return apiClient.get<PlanPage>('/billing/plans', {
    searchParams: {
      page: filter?.page,
      limit: filter?.limit,
      search: filter?.search?.trim() || undefined,
      sortBy: filter?.sortBy,
      sortOrder: filter?.sortOrder,
      audience: filter?.audience,
      // Sent only when asked for: the API default (false) lists active plans only.
      includeInactive: filter?.includeInactive ? true : undefined,
    },
  });
}

export async function getPlan(id: string): Promise<Plan> {
  return apiClient.get<Plan>(`/billing/plans/${encodeURIComponent(id)}`);
}

export async function createPlan(request: CreatePlanRequest): Promise<Plan> {
  return apiClient.post<Plan>('/billing/plans', request);
}

export async function updatePlan(id: string, request: UpdatePlanRequest): Promise<Plan> {
  return apiClient.patch<Plan>(`/billing/plans/${encodeURIComponent(id)}`, request);
}

/** Makes the plan purchasable again (PATCH isActive=true). */
export async function activatePlan(id: string): Promise<Plan> {
  return updatePlan(id, { isActive: true });
}

/** Stops new purchases of the plan; existing subscriptions are unaffected (PATCH isActive=false). */
export async function deactivatePlan(id: string): Promise<Plan> {
  return updatePlan(id, { isActive: false });
}

/** Archives the plan (DELETE). The API refuses while trialing/active/past-due subscribers remain. */
export async function archivePlan(id: string): Promise<ArchivePlanResult> {
  return apiClient.delete<ArchivePlanResult>(`/billing/plans/${encodeURIComponent(id)}`);
}
```

FILE: apps/admin-web/src/modules/billing/plans/plan-catalog-management.tsx

```tsx
'use client';

import React, { useEffect, useState } from 'react';

import { ApiError } from '@wlct/utils/api-error';

import { activatePlan, archivePlan, createPlan, deactivatePlan, getPlans, updatePlan } from './plan-api';
import { formatAudience, formatBps, formatInterval, formatPrice, formatStatus, LIMIT_LABELS } from './plan-formatters';
import {
  BILLING_INTERVALS,
  PLAN_AUDIENCES,
  PLAN_CURRENCIES,
  type BillingInterval,
  type CreatePlanRequest,
  type Plan,
  type PlanAudience,
  type PlanCurrency,
  type PlanLimits,
  type PlanPage,
  planStatus,
  PlanStatus,
} from './plan-types';

/**
 * Plan catalogue (round 7): lists the plans the caller can see and, with
 * `plan:manage`, creates, edits, activates/deactivates and archives them.
 * Every action is a /v1/billing/plans route; the API re-authorises each call
 * (platform operators manage the platform catalogue, a tenant only its own
 * plans) and refuses archiving a plan that still has live subscribers.
 * Prices are entered and shown as decimal strings; nothing is computed here.
 */

const PAGE_SIZE = 25;

const NUMERIC_LIMITS: Array<keyof PlanLimits> = [
  'maxUsers',
  'maxTraders',
  'maxFollowersPerTrader',
  'maxExchangeAccountsPerUser',
  'maxCopySubscriptionsPerFollower',
  'maxApiRequestsPerMinute',
  'websocketConnections',
];
const BOOLEAN_LIMITS: Array<keyof PlanLimits> = ['customDomain', 'whiteLabelMobileApp', 'prioritySupport'];

interface PlanForm {
  code: string;
  name: string;
  description: string;
  audience: PlanAudience;
  price: string;
  currency: PlanCurrency;
  interval: BillingInterval;
  trialDays: string;
  platformFeeBps: string;
  performanceFeeBps: string;
  sortOrder: string;
  features: string;
  isActive: boolean;
  limits: Record<string, string | boolean>;
}

function emptyForm(): PlanForm {
  const limits: Record<string, string | boolean> = {};
  NUMERIC_LIMITS.forEach((key) => (limits[key] = ''));
  BOOLEAN_LIMITS.forEach((key) => (limits[key] = false));
  return {
    code: '',
    name: '',
    description: '',
    audience: 'TENANT',
    price: '',
    currency: 'USD',
    interval: 'MONTHLY',
    trialDays: '0',
    platformFeeBps: '0',
    performanceFeeBps: '0',
    sortOrder: '0',
    features: '',
    isActive: true,
    limits,
  };
}

function formFromPlan(plan: Plan): PlanForm {
  const limits: Record<string, string | boolean> = {};
  NUMERIC_LIMITS.forEach((key) => {
    const value = plan.limits?.[key];
    limits[key] = value === null || value === undefined ? '' : String(value);
  });
  BOOLEAN_LIMITS.forEach((key) => (limits[key] = Boolean(plan.limits?.[key])));
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description ?? '',
    audience: plan.audience as PlanAudience,
    price: String(plan.price),
    currency: plan.currency as PlanCurrency,
    interval: plan.interval as BillingInterval,
    trialDays: String(plan.trialDays ?? 0),
    platformFeeBps: String(plan.platformFeeBps ?? 0),
    performanceFeeBps: String(plan.performanceFeeBps ?? 0),
    sortOrder: String(plan.sortOrder ?? 0),
    features: (plan.features ?? []).join(', '),
    isActive: plan.isActive,
    limits,
  };
}

/** Blank numeric limit = unlimited (null). */
function limitsFromForm(form: PlanForm): Partial<PlanLimits> {
  const limits: Record<string, number | boolean | null> = {};
  NUMERIC_LIMITS.forEach((key) => {
    const raw = String(form.limits[key] ?? '').trim();
    limits[key] = raw === '' ? null : Number.parseInt(raw, 10);
  });
  BOOLEAN_LIMITS.forEach((key) => (limits[key] = Boolean(form.limits[key])));
  return limits as Partial<PlanLimits>;
}

function featuresFromForm(form: PlanForm): string[] {
  return [...new Set(form.features.split(',').map((f) => f.trim()).filter(Boolean))];
}

function toInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = Object.entries(error.fieldErrors);
    return fields.length > 0 ? `${error.message} (${fields.map(([f, m]) => `${f}: ${m}`).join('; ')})` : error.message;
  }
  return error instanceof Error ? error.message : 'The request failed';
}

export default function PlanCatalogManagement({ canManage }: { canManage: boolean }) {
  const [page, setPage] = useState<PlanPage | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [search, setSearch] = useState('');
  // Managers need inactive plans listed, otherwise a deactivated plan vanishes
  // and can never be re-activated from here. Readers default to what is on sale.
  const [includeInactive, setIncludeInactive] = useState(canManage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [form, setForm] = useState<PlanForm>(emptyForm());

  const load = async (requestedPage = pageNumber) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPlans({ page: requestedPage, limit: PAGE_SIZE, search, sortBy: 'sortOrder', sortOrder: 'asc', includeInactive });
      setPage(result);
      setPageNumber(requestedPage);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeInactive]);

  /** Runs one API action; true when it succeeded (the list is then reloaded). */
  const runAction = async (key: string, action: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusy(key);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await load();
      return true;
    } catch (e) {
      setMessage(`Error: ${errorText(e)}`);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const openCreate = () => {
    setForm(emptyForm());
    setEditing('new');
    setMessage(null);
  };

  const openEdit = (plan: Plan) => {
    setForm(formFromPlan(plan));
    setEditing(plan);
    setMessage(null);
  };

  const save = async () => {
    if (editing === null) return;
    const common = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      price: form.price.trim(),
      interval: form.interval,
      trialDays: toInt(form.trialDays),
      platformFeeBps: toInt(form.platformFeeBps),
      performanceFeeBps: toInt(form.performanceFeeBps),
      sortOrder: toInt(form.sortOrder),
      features: featuresFromForm(form),
      limits: limitsFromForm(form),
      isActive: form.isActive,
    };
    if (editing === 'new') {
      const request: CreatePlanRequest = {
        ...common,
        code: form.code.trim().toLowerCase(),
        audience: form.audience,
        currency: form.currency,
      };
      if (await runAction('save', () => createPlan(request), `Plan ${request.code} created`)) setEditing(null);
    } else if (await runAction('save', () => updatePlan(editing.id, common), `Plan ${editing.code} updated`)) {
      setEditing(null);
    }
  };

  const plans = page?.items ?? [];
  const totalPages = page?.pagination.totalPages ?? 1;

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Plan catalogue</h1>
          <p className="text-sm text-gray-500 mt-1">
            Plans, prices, limits and features come from the billing API. Changing a plan never edits an existing subscription.
          </p>
        </div>
        {canManage && (
          <button onClick={openCreate} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">
            New plan
          </button>
        )}
      </div>

      {message && <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">{message}</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">{error}</div>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(1);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          placeholder="Search plans by name or code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 border rounded px-3 py-2 text-sm"
        />
        <button type="submit" className="px-4 py-2 bg-gray-800 text-white rounded text-sm">
          Search
        </button>
        <button type="button" onClick={() => load()} className="px-3 py-2 border rounded text-sm">
          Refresh
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          <span>Show inactive</span>
        </label>
      </form>

      <div className="bg-white border rounded-lg p-4">
        {loading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-8 bg-gray-200 rounded" />
            <div className="h-8 bg-gray-200 rounded" />
            <div className="h-8 bg-gray-200 rounded" />
          </div>
        ) : plans.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-12">No plans found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2">Code</th>
                  <th className="py-2">Name</th>
                  <th className="py-2">Audience</th>
                  <th className="py-2">Price</th>
                  <th className="py-2">Fees</th>
                  <th className="py-2">Scope</th>
                  <th className="py-2">Status</th>
                  {canManage && <th className="py-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => {
                  const status = planStatus(plan);
                  return (
                    <tr key={plan.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 font-mono text-xs">{plan.code}</td>
                      <td className="py-2">
                        {plan.name}
                        <p className="text-xs text-gray-500">{formatInterval(plan.interval)}{plan.trialDays > 0 ? ` - ${plan.trialDays}-day trial` : ''}</p>
                      </td>
                      <td className="py-2 text-xs">{formatAudience(plan.audience)}</td>
                      <td className="py-2">{formatPrice(plan)}</td>
                      <td className="py-2 text-xs">
                        Platform {formatBps(plan.platformFeeBps)}
                        <br />
                        Performance {formatBps(plan.performanceFeeBps)}
                      </td>
                      <td className="py-2 text-xs">{plan.tenantId ? 'Organisation plan' : 'Platform plan'}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${status === PlanStatus.ACTIVE ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                          {formatStatus(status)}
                        </span>
                      </td>
                      {canManage && (
                        <td className="py-2">
                          <div className="flex gap-2 flex-wrap">
                            <button onClick={() => openEdit(plan)} disabled={!!busy} className="text-blue-600 hover:underline text-xs disabled:opacity-50">
                              Edit
                            </button>
                            {plan.isActive ? (
                              <button
                                onClick={() => runAction(`deactivate:${plan.id}`, () => deactivatePlan(plan.id), `Plan ${plan.code} is no longer offered`)}
                                disabled={!!busy}
                                className="text-yellow-700 hover:underline text-xs disabled:opacity-50"
                              >
                                Deactivate
                              </button>
                            ) : (
                              <button
                                onClick={() => runAction(`activate:${plan.id}`, () => activatePlan(plan.id), `Plan ${plan.code} is offered again`)}
                                disabled={!!busy}
                                className="text-green-600 hover:underline text-xs disabled:opacity-50"
                              >
                                Activate
                              </button>
                            )}
                            <button
                              onClick={() => {
                                if (window.confirm(`Archive plan ${plan.code}? The API refuses while it still has trialing, active or past-due subscribers.`)) {
                                  runAction(`archive:${plan.id}`, () => archivePlan(plan.id), `Plan ${plan.code} archived`);
                                }
                              }}
                              disabled={!!busy}
                              className="text-red-600 hover:underline text-xs disabled:opacity-50"
                            >
                              Archive
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-between items-center pt-3 text-xs text-gray-500">
          <span>
            {page?.pagination.totalItems ?? 0} plans - page {pageNumber} of {Math.max(1, totalPages)}
          </span>
          <div className="flex gap-2">
            <button onClick={() => load(pageNumber - 1)} disabled={loading || pageNumber <= 1} className="px-3 py-1 border rounded disabled:opacity-50">
              Previous
            </button>
            <button onClick={() => load(pageNumber + 1)} disabled={loading || pageNumber >= totalPages} className="px-3 py-1 border rounded disabled:opacity-50">
              Next
            </button>
          </div>
        </div>
      </div>

      {editing !== null && canManage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full overflow-y-auto" style={{ maxWidth: 720, maxHeight: '90vh' }}>
            <h3 className="font-semibold mb-4">{editing === 'new' ? 'New plan' : `Edit plan ${editing.code}`}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Code (lowercase slug, cannot change later)</span>
                <input
                  type="text"
                  value={form.code}
                  disabled={editing !== 'new'}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Name</span>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Description</span>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Audience (cannot change later)</span>
                <select
                  value={form.audience}
                  disabled={editing !== 'new'}
                  onChange={(e) => setForm({ ...form, audience: e.target.value as PlanAudience })}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  {PLAN_AUDIENCES.map((a) => (
                    <option key={a} value={a}>
                      {formatAudience(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Price (decimal, e.g. 49.00)</span>
                <input type="text" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Currency (cannot change later)</span>
                <select
                  value={form.currency}
                  disabled={editing !== 'new'}
                  onChange={(e) => setForm({ ...form, currency: e.target.value as PlanCurrency })}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  {PLAN_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Billing interval</span>
                <select value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value as BillingInterval })} className="w-full border rounded px-3 py-2 text-sm">
                  {BILLING_INTERVALS.map((i) => (
                    <option key={i} value={i}>
                      {formatInterval(i)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Trial days</span>
                <input type="number" min={0} value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Platform fee (basis points)</span>
                <input type="number" min={0} value={form.platformFeeBps} onChange={(e) => setForm({ ...form, platformFeeBps: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Performance fee (basis points)</span>
                <input type="number" min={0} value={form.performanceFeeBps} onChange={(e) => setForm({ ...form, performanceFeeBps: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Sort order</span>
                <input type="number" min={0} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Features (comma-separated keys)</span>
                <input type="text" value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
            </div>

            <h4 className="font-medium text-sm mt-4 mb-2">Limits (blank = unlimited)</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {NUMERIC_LIMITS.map((key) => (
                <label key={key} className="space-y-1">
                  <span className="block text-xs text-gray-500">{LIMIT_LABELS[key]}</span>
                  <input
                    type="number"
                    min={0}
                    value={String(form.limits[key] ?? '')}
                    onChange={(e) => setForm({ ...form, limits: { ...form.limits, [key]: e.target.value } })}
                    className="w-full border rounded px-3 py-2 text-sm"
                  />
                </label>
              ))}
              {BOOLEAN_LIMITS.map((key) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(form.limits[key])}
                    onChange={(e) => setForm({ ...form, limits: { ...form.limits, [key]: e.target.checked } })}
                  />
                  <span className="text-sm">{LIMIT_LABELS[key]}</span>
                </label>
              ))}
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                <span className="text-sm">Offered for purchase (active)</span>
              </label>
            </div>

            {message && message.startsWith('Error:') && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800 mt-4">{message}</div>
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={save}
                disabled={busy === 'save' || !form.name.trim() || !form.price.trim() || (editing === 'new' && !form.code.trim())}
                className="flex-1 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50"
              >
                {busy === 'save' ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setEditing(null)} className="flex-1 py-2 border rounded text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

FILE: apps/admin-web/src/modules/billing/plans/plan-formatters.ts

```typescript
/**
 * Plan Formatters for Admin Web
 *
 * Display helpers over the API's plan shape (`SubscriptionPlanDto`). Prices
 * are decimal strings and are never converted to floating point for
 * arithmetic; nothing here invents a price (the former "annual savings"
 * helper assumed a ten-month yearly price that no plan defines, and was
 * removed with the tier helpers in round 7).
 */

import {
  type BillingInterval,
  type Plan,
  type PlanAudience,
  type PlanLimits,
  PlanStatus,
  planStatus,
} from './plan-types';

const INTERVAL_SUFFIX: Record<BillingInterval, string> = {
  MONTHLY: '/mo',
  QUARTERLY: '/qtr',
  YEARLY: '/yr',
  LIFETIME: ' one-time',
};

const INTERVAL_LABEL: Record<BillingInterval, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
  LIFETIME: 'Lifetime',
};

const AUDIENCE_LABEL: Record<PlanAudience, string> = {
  TENANT: 'Organisations (B2B)',
  END_USER: 'End users (B2C)',
};

/** Human labels for the PlanLimits keys. */
export const LIMIT_LABELS: Record<keyof PlanLimits, string> = {
  maxUsers: 'Users',
  maxTraders: 'Traders',
  maxFollowersPerTrader: 'Followers per trader',
  maxExchangeAccountsPerUser: 'Exchange accounts per user',
  maxCopySubscriptionsPerFollower: 'Copy subscriptions per follower',
  maxApiRequestsPerMinute: 'API requests per minute',
  websocketConnections: 'WebSocket connections',
  customDomain: 'Custom domain',
  whiteLabelMobileApp: 'White-label mobile app',
  prioritySupport: 'Priority support',
};

/** "49.00 USD/mo"; a zero price is "Free". The decimal string is shown as stored. */
export function formatPrice(plan: Pick<Plan, 'price' | 'currency' | 'interval'>): string {
  const isZero = /^0+(\.0+)?$/.test(String(plan.price).trim());
  if (isZero) return 'Free';
  const suffix = INTERVAL_SUFFIX[plan.interval as BillingInterval] ?? '';
  return `${plan.price} ${plan.currency}${suffix}`;
}

export function formatInterval(interval: BillingInterval | string): string {
  return INTERVAL_LABEL[interval as BillingInterval] ?? interval;
}

export function formatAudience(audience: PlanAudience | string): string {
  return AUDIENCE_LABEL[audience as PlanAudience] ?? audience;
}

export function formatStatus(status: PlanStatus): string {
  return status === PlanStatus.ACTIVE ? 'Active' : 'Inactive';
}

export function getStatusColor(status: PlanStatus): string {
  return status === PlanStatus.ACTIVE ? '#10B981' : '#6B7280';
}

/** Basis points as a percentage: 250 -> "2.50%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** A single limit: numbers (null = unlimited) or booleans (included / not included). */
export function formatLimit(key: keyof PlanLimits, value: PlanLimits[keyof PlanLimits]): string {
  const label = LIMIT_LABELS[key] ?? key;
  if (typeof value === 'boolean') return `${label}: ${value ? 'Included' : 'Not included'}`;
  if (value === null || value === undefined) return `${label}: Unlimited`;
  return `${label}: ${value.toLocaleString('en-US')}`;
}

export function formatPlanSummary(plan: Plan): string {
  return `${plan.name} (${plan.code}) - ${formatPrice(plan)} - ${formatStatus(planStatus(plan))}`;
}

/**
 * A comparison table: header row, one row per feature (from the plans'
 * `features` arrays) and one row per limit.
 */
export function formatPlanComparison(plans: Plan[]): string[][] {
  const rows: string[][] = [['Feature', ...plans.map((p) => p.name)]];

  const featureKeys = new Set<string>();
  plans.forEach((p) => (p.features ?? []).forEach((f) => featureKeys.add(f)));
  [...featureKeys].sort().forEach((featureKey) => {
    rows.push([featureKey, ...plans.map((plan) => ((plan.features ?? []).includes(featureKey) ? '✓' : '✗'))]);
  });

  (Object.keys(LIMIT_LABELS) as Array<keyof PlanLimits>).forEach((key) => {
    rows.push([
      LIMIT_LABELS[key],
      ...plans.map((plan) => {
        const value = plan.limits?.[key];
        if (typeof value === 'boolean') return value ? '✓' : '✗';
        if (value === null || value === undefined) return 'Unlimited';
        return value.toLocaleString('en-US');
      }),
    ]);
  });

  return rows;
}
```

FILE: apps/admin-web/src/modules/billing/plans/plan-types.ts

```typescript
/**
 * Plan Types for Admin Web
 *
 * The plan shape is the API's own contract (`SubscriptionPlanDto` from
 * @wlct/shared-types, served by /v1/billing/plans). An earlier version of this
 * module described a different, never-implemented API (tiers, slugs, price
 * objects, plan stats/history); it was removed in round 7 so the console can
 * only call routes that exist.
 */

import type {
  BillingInterval as SharedBillingInterval,
  PlanAudience as SharedPlanAudience,
  PlanLimits as SharedPlanLimits,
  SubscriptionPlanDto,
} from '@wlct/shared-types';

/** A plan exactly as GET /v1/billing/plans returns it. */
export type Plan = SubscriptionPlanDto;

export type PlanLimits = SharedPlanLimits;

/** Billing intervals the API accepts (`BillingInterval` in shared-types). */
export const BILLING_INTERVALS = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'LIFETIME'] as const;
export type BillingInterval = `${SharedBillingInterval}`;

/** Plan audiences the API accepts (`PlanAudience` in shared-types). */
export const PLAN_AUDIENCES = ['TENANT', 'END_USER'] as const;
export type PlanAudience = `${SharedPlanAudience}`;

/** Currencies CreatePlanDto accepts. */
export const PLAN_CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'BDT', 'TRY'] as const;
export type PlanCurrency = (typeof PLAN_CURRENCIES)[number];

/** Derived lifecycle shown in the console; the API stores `isActive` (archive = DELETE). */
export enum PlanStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/**
 * Query keys GET /v1/billing/plans accepts (ListPlansDto = PaginationQueryDto +
 * audience). Any other key is refused with 422 by the API's validation pipe.
 */
export interface PlanFilter {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  audience?: PlanAudience;
  /** ListPlansDto.includeInactive: without it the API returns active plans only. */
  includeInactive?: boolean;
}

/** The paginated envelope the list route returns (after the {success,data} unwrap). */
export interface PlanPage {
  items: Plan[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
  };
}

/** POST /v1/billing/plans body (CreatePlanDto). */
export interface CreatePlanRequest {
  code: string;
  name: string;
  description?: string;
  audience?: PlanAudience;
  price: string;
  currency?: PlanCurrency;
  interval?: BillingInterval;
  trialDays?: number;
  performanceFeeBps?: number;
  platformFeeBps?: number;
  limits?: Partial<PlanLimits>;
  features?: string[];
  isActive?: boolean;
  sortOrder?: number;
  externalPriceId?: string;
}

/** PATCH /v1/billing/plans/:id body (UpdatePlanDto). Code, audience and currency are immutable. */
export interface UpdatePlanRequest {
  name?: string;
  description?: string;
  price?: string;
  interval?: BillingInterval;
  trialDays?: number;
  performanceFeeBps?: number;
  platformFeeBps?: number;
  limits?: Partial<PlanLimits>;
  features?: string[];
  isActive?: boolean;
  sortOrder?: number;
  externalPriceId?: string;
}

/** DELETE /v1/billing/plans/:id result. */
export interface ArchivePlanResult {
  id: string;
  archived: true;
}

export function planStatus(plan: Pick<Plan, 'isActive'>): PlanStatus {
  return plan.isActive ? PlanStatus.ACTIVE : PlanStatus.INACTIVE;
}
```

FILE: apps/admin-web/src/modules/billing/portal/billing-portal-api.ts

```typescript
/**
 * Billing Portal API client for admin-web.
 * Consumes canonical billing APIs, never hardcodes pricing.
 * No secrets exposed.
 */

import { apiClient } from '@/lib/api-client';

const PROXY_PREFIX = '/api/proxy';
const API_BASE = `${PROXY_PREFIX}/billing/portal`;

/**
 * All calls go through the console's same-origin proxy (/api/proxy/* ->
 * API_BASE_URL/v1/*): the bearer token lives in an httpOnly cookie that only
 * the proxy can read, and mutations carry the CSRF header. Before this the
 * module fetched `{API_BASE}` on the admin origin, which has no such route, so
 * every call 404'd. apiClient also unwraps the {success, data} envelope, which
 * is the shape the billing components read (e.g. `result.tenantSlug`).
 */
async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const path = url.startsWith(PROXY_PREFIX) ? url.slice(PROXY_PREFIX.length) : url;
  const method = (options?.method ?? 'GET').toUpperCase();
  const body =
    typeof options?.body === 'string' && options.body.length > 0 ? JSON.parse(options.body) : undefined;
  switch (method) {
    case 'POST':
      return apiClient.post(path, body);
    case 'PATCH':
      return apiClient.patch(path, body);
    case 'PUT':
      return apiClient.put(path, body);
    case 'DELETE':
      return apiClient.delete(path, body === undefined ? {} : { body });
    default:
      return apiClient.get(path);
  }
}

export async function getBillingOverview(): Promise<any> {
  return fetchJson(`${API_BASE}/overview`);
}

export async function getCurrentSubscription(): Promise<any> {
  return fetchJson(`${API_BASE}/subscription`);
}

export async function getAvailablePlans(): Promise<any> {
  return fetchJson(`${API_BASE}/plans`);
}

export async function getPlanComparison(): Promise<any> {
  return fetchJson(`${API_BASE}/plans/comparison`);
}

export async function getUsageSummary(): Promise<any> {
  return fetchJson(`${API_BASE}/usage`);
}

export async function listInvoices(params?: { status?: string; limit?: number; fromDate?: string; toDate?: string }): Promise<any> {
  const q = new URLSearchParams();
  if (params?.status) q.append('status', params.status);
  if (params?.limit) q.append('limit', String(params.limit));
  if (params?.fromDate) q.append('fromDate', params.fromDate);
  if (params?.toDate) q.append('toDate', params.toDate);
  return fetchJson(`${API_BASE}/invoices?${q.toString()}`);
}

export async function getInvoiceDetail(id: string): Promise<any> {
  return fetchJson(`${API_BASE}/invoices/${id}`);
}

export async function getInvoicePdfMetadata(id: string): Promise<any> {
  return fetchJson(`${API_BASE}/invoices/${id}/pdf-metadata`);
}

export async function listPayments(params?: { status?: string; provider?: string; limit?: number }): Promise<any> {
  const q = new URLSearchParams();
  if (params?.status) q.append('status', params.status);
  if (params?.provider) q.append('provider', params.provider);
  if (params?.limit) q.append('limit', String(params.limit));
  return fetchJson(`${API_BASE}/payments?${q.toString()}`);
}

export async function getPaymentDetail(id: string): Promise<any> {
  return fetchJson(`${API_BASE}/payments/${id}`);
}

export async function getPaymentStatus(id: string): Promise<any> {
  return fetchJson(`${API_BASE}/payments/${id}/status`);
}

export async function createCheckoutSession(payload: { planId: string; billingInterval?: string; currency?: string; provider?: string; successUrl?: string; cancelUrl?: string; idempotencyKey?: string }): Promise<any> {
  return fetchJson(`${API_BASE}/checkout`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getCheckoutStatus(id: string): Promise<any> {
  return fetchJson(`${API_BASE}/checkout/${id}/status`);
}

export async function cancelSubscription(payload: { reason?: string; atPeriodEnd?: boolean }): Promise<any> {
  return fetchJson(`${API_BASE}/subscription/cancel`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function resumeSubscription(): Promise<any> {
  return fetchJson(`${API_BASE}/subscription/resume`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function changePlan(payload: { planId: string; atPeriodEnd?: boolean }): Promise<any> {
  return fetchJson(`${API_BASE}/subscription/change-plan`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function changeInterval(payload: { newInterval: string; atPeriodEnd?: boolean }): Promise<any> {
  return fetchJson(`${API_BASE}/subscription/change-interval`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
```

FILE: apps/admin-web/src/modules/billing/portal/billing-portal-page.tsx

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import {
  getBillingOverview,
  listInvoices,
  listPayments,
} from './billing-portal-api';

/**
 * Main SaaS billing dashboard: current plan, subscription status, usage,
 * invoices, payment history, and available actions.
 * No hardcoded plan data - all from API.
 */
export default function BillingPortalPage() {
  const [overview, setOverview] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, invRes, payRes] = await Promise.all([
        getBillingOverview(),
        listInvoices({ limit: 5 }),
        listPayments({ limit: 5 }),
      ]);
      setOverview(ov);
      setInvoices(invRes.invoices || []);
      setPayments(payRes.payments || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load billing data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-32 bg-gray-200 rounded" />
          <div className="h-48 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <h3 className="text-red-800 font-medium">Error loading billing data</h3>
          <p className="text-red-600 text-sm mt-1">{error}</p>
          <button onClick={fetchData} className="mt-3 px-4 py-2 bg-red-600 text-white rounded text-sm">Retry</button>
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <p className="text-gray-500">No billing data available</p>
          <button onClick={fetchData} className="mt-2 text-blue-600 text-sm">Refresh</button>
        </div>
      </div>
    );
  }

  const sub = overview.subscription;
  const currentPlan = overview.currentPlan;
  const usage = overview.usage;
  const isInactive = !sub?.isActive;

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Billing & Subscription</h1>
        <button onClick={fetchData} className="text-sm text-gray-600 hover:text-gray-900">Refresh</button>
      </div>

      {/* Current Subscription */}
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Current Subscription</h2>
        {isInactive ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
            <p className="text-yellow-800">No active subscription</p>
            <p className="text-yellow-600 text-sm mt-1">Choose a plan to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-500">Plan</p>
              <p className="font-medium">{currentPlan?.name || sub.planName || 'Unknown'}</p>
              <p className="text-xs text-gray-400">{sub.planCode}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${sub.isActive ? 'bg-green-100 text-green-800' : sub.isPastDue ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                {sub.status || 'UNKNOWN'}
              </span>
              {sub.willCancelAtPeriodEnd && <p className="text-xs text-orange-600 mt-1">Cancels at period end</p>}
            </div>
            <div>
              <p className="text-sm text-gray-500">Renewal Date</p>
              <p className="font-medium">{sub.renewalDate ? new Date(sub.renewalDate).toLocaleDateString() : 'N/A'}</p>
              {sub.trialActive && <p className="text-xs text-blue-600">Trial active until {sub.trialEndsAt ? new Date(sub.trialEndsAt).toLocaleDateString() : ''}</p>}
            </div>
            <div>
              <p className="text-sm text-gray-500">Interval</p>
              <p className="font-medium">{sub.interval || currentPlan?.interval || 'N/A'}</p>
            </div>
          </div>
        )}
      </div>

      {/* Usage */}
      {usage && (
        <div className="bg-white border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Usage & Limits</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {usage.items?.map((item: any) => (
              <div key={item.key} className="border rounded p-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="text-xs text-gray-500">{item.unlimited ? 'Unlimited' : `${item.current}/${item.limit}`}</span>
                </div>
                {!item.unlimited && (
                  <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${Math.min(100, item.percentageUsed || 0)}%` }} />
                  </div>
                )}
                {item.remaining !== null && !item.unlimited && (
                  <p className="text-xs text-gray-500 mt-1">{item.remaining} remaining</p>
                )}
              </div>
            ))}
          </div>
          {usage.features?.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium mb-2">Features</h3>
              <div className="flex flex-wrap gap-2">
                {usage.features.map((f: any) => (
                  <span key={f.key} className={`px-2 py-1 rounded text-xs ${f.included ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                    {f.label}: {f.included ? 'Included' : 'Not included'}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Latest Invoice & Payment */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border rounded-lg p-6">
          <h3 className="font-semibold mb-3">Latest Invoice</h3>
          {overview.latestInvoice ? (
            <div className="space-y-2 text-sm">
              <p><span className="text-gray-500">Number:</span> {overview.latestInvoice.invoiceNumber}</p>
              <p><span className="text-gray-500">Status:</span> <span className={`px-2 py-0.5 rounded text-xs ${overview.latestInvoice.status === 'PAID' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{overview.latestInvoice.status}</span></p>
              <p><span className="text-gray-500">Total:</span> {overview.latestInvoice.total} {overview.latestInvoice.currency}</p>
              <p><span className="text-gray-500">Due:</span> {overview.latestInvoice.amountDue} {overview.latestInvoice.currency}</p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No invoices yet</p>
          )}
          {invoices.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-600 mb-2">Recent Invoices</p>
              {invoices.slice(0, 3).map((inv: any) => (
                <div key={inv.id} className="flex justify-between text-xs py-1 border-b">
                  <span>{inv.invoiceNumber}</span>
                  <span className={inv.status === 'PAID' ? 'text-green-600' : 'text-yellow-600'}>{inv.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border rounded-lg p-6">
          <h3 className="font-semibold mb-3">Latest Payment</h3>
          {overview.latestPayment ? (
            <div className="space-y-2 text-sm">
              <p><span className="text-gray-500">Provider:</span> {overview.latestPayment.provider}</p>
              <p><span className="text-gray-500">Status:</span> <span className={`px-2 py-0.5 rounded text-xs ${overview.latestPayment.status === 'SUCCEEDED' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{overview.latestPayment.status}</span></p>
              <p><span className="text-gray-500">Amount:</span> {overview.latestPayment.amount} {overview.latestPayment.currency}</p>
              <p><span className="text-gray-500">Date:</span> {new Date(overview.latestPayment.createdAt).toLocaleDateString()}</p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No payments yet</p>
          )}
          {payments.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-600 mb-2">Recent Payments</p>
              {payments.slice(0, 3).map((pay: any) => (
                <div key={pay.id} className="flex justify-between text-xs py-1 border-b">
                  <span>{pay.amount} {pay.currency}</span>
                  <span className={pay.status === 'SUCCEEDED' ? 'text-green-600' : 'text-yellow-600'}>{pay.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Available Actions */}
      {overview.availableActions?.length > 0 && (
        <div className="bg-white border rounded-lg p-6">
          <h3 className="font-semibold mb-3">Available Actions</h3>
          <div className="flex flex-wrap gap-2">
            {overview.availableActions.map((action: string) => (
              <span key={action} className="px-3 py-1 bg-blue-50 text-blue-700 rounded text-sm border border-blue-200">{action.replace(/_/g, ' ')}</span>
            ))}
          </div>
        </div>
      )}

      {/* Billing Customer */}
      {overview.billingCustomer && (
        <div className="bg-white border rounded-lg p-6">
          <h3 className="font-semibold mb-3">Billing Profile</h3>
          <div className="text-sm space-y-1">
            <p><span className="text-gray-500">Name:</span> {overview.billingCustomer.billingName}</p>
            <p><span className="text-gray-500">Email:</span> {overview.billingCustomer.billingEmail}</p>
            <p><span className="text-gray-500">Country:</span> {overview.billingCustomer.billingCountry}</p>
            <p><span className="text-gray-500">Currency:</span> {overview.billingCustomer.preferredCurrency}</p>
          </div>
        </div>
      )}
    </div>
  );
}
```

FILE: apps/admin-web/src/modules/billing/portal/checkout-page.tsx

```tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createCheckoutSession, getCheckoutStatus, getPaymentStatus } from './billing-portal-api';

/**
 * Checkout page that creates backend checkout session and redirects to provider.
 * After redirect, verifies actual payment/subscription state from backend.
 * Never trusts ?success=true alone.
 */
export default function CheckoutPage({ planId, onClose }: { planId: string; onClose?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<any>(null);
  const [verificationState, setVerificationState] = useState<'idle' | 'pending' | 'verifying' | 'success' | 'failed' | 'cancelled' | 'expired'>('idle');
  const [paymentId, setPaymentId] = useState<string | null>(null);

  // Each verification run gets a number; a newer run (Refresh Status, or a
  // second return from the provider) supersedes the polling of an older one,
  // and unmounting stops polling altogether.
  const runRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const verifyPayment = useCallback(async (id: string) => {
    const run = ++runRef.current;
    const superseded = () => !mountedRef.current || run !== runRef.current;
    setVerificationState('verifying');
    try {
      for (;;) {
        // Always call backend to verify actual payment state
        const status = await getCheckoutStatus(id);
        const paymentStatus = await getPaymentStatus(id).catch(() => null);
        if (superseded()) return;

        if (status.status === 'COMPLETED' || status.paymentStatus === 'SUCCEEDED' || paymentStatus?.status === 'SUCCEEDED') {
          setVerificationState('success');
          return;
        }
        if (status.status === 'FAILED' || status.paymentStatus === 'FAILED') {
          setVerificationState('failed');
          return;
        }
        if (status.status === 'CANCELLED' || status.paymentStatus === 'CANCELLED') {
          setVerificationState('cancelled');
          return;
        }
        if (status.status === 'EXPIRED' || status.paymentStatus === 'EXPIRED') {
          setVerificationState('expired');
          return;
        }
        setVerificationState('pending');
        // Poll for pending
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (superseded()) return;
      }
    } catch (e: any) {
      if (superseded()) return;
      setError(e.message || 'Failed to verify payment');
      setVerificationState('failed');
    }
  }, []);

  // Check if returning from provider
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutId = params.get('checkout_id') || params.get('payment_id') || params.get('session_id');
    const paymentIdParam = params.get('payment_id');

    if (checkoutId || paymentIdParam) {
      const id = checkoutId || paymentIdParam;
      if (id) {
        setPaymentId(id);
        setVerificationState('verifying');
        void verifyPayment(id);
      }
    }
  }, [verifyPayment]);

  const handleCreateCheckout = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await createCheckoutSession({
        planId,
        successUrl: `${window.location.origin}/billing/checkout?checkout_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${window.location.origin}/billing/plans`,
      });

      setCheckout(result);
      setPaymentId(result.paymentId || result.checkoutId);

      // Redirect to provider checkout URL - backend decides provider/price
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      } else {
        setError('No checkout URL returned');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to create checkout');
    } finally {
      setLoading(false);
    }
  };

  // Verification states UI
  if (verificationState !== 'idle') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div className="bg-white border rounded-lg p-6 text-center">
          {verificationState === 'verifying' && (
            <>
              <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
              <h3 className="font-semibold">Verifying payment...</h3>
              <p className="text-sm text-gray-500 mt-1">Checking backend payment state, please wait</p>
              <p className="text-xs text-gray-400 mt-2">Payment ID: {paymentId}</p>
            </>
          )}
          {verificationState === 'pending' && (
            <>
              <div className="h-8 w-8 bg-yellow-100 rounded-full mx-auto mb-4 flex items-center justify-center">⏳</div>
              <h3 className="font-semibold">Payment pending</h3>
              <p className="text-sm text-gray-500 mt-1">Provider is processing your payment</p>
              <button onClick={() => paymentId && verifyPayment(paymentId)} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded text-sm">Refresh Status</button>
            </>
          )}
          {verificationState === 'success' && (
            <>
              <div className="h-8 w-8 bg-green-100 rounded-full mx-auto mb-4 flex items-center justify-center text-green-600">✓</div>
              <h3 className="font-semibold text-green-800">Payment successful!</h3>
              <p className="text-sm text-gray-600 mt-1">Your subscription has been updated. Verified from backend.</p>
              <button onClick={() => (window.location.href = '/billing')} className="mt-4 px-4 py-2 bg-green-600 text-white rounded text-sm">Go to Billing</button>
            </>
          )}
          {verificationState === 'failed' && (
            <>
              <div className="h-8 w-8 bg-red-100 rounded-full mx-auto mb-4 flex items-center justify-center text-red-600">✗</div>
              <h3 className="font-semibold text-red-800">Payment failed</h3>
              <p className="text-sm text-gray-500 mt-1">Your payment could not be processed</p>
              {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
              <div className="mt-4 flex gap-2 justify-center">
                <button onClick={() => setVerificationState('idle')} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">Try Again</button>
                <button onClick={() => (window.location.href = '/billing')} className="px-4 py-2 border rounded text-sm">Back to Billing</button>
              </div>
            </>
          )}
          {verificationState === 'cancelled' && (
            <>
              <h3 className="font-semibold">Payment cancelled</h3>
              <p className="text-sm text-gray-500 mt-1">You cancelled the checkout</p>
              <button onClick={() => (window.location.href = '/billing/plans')} className="mt-4 px-4 py-2 bg-gray-600 text-white rounded text-sm">Back to Plans</button>
            </>
          )}
          {verificationState === 'expired' && (
            <>
              <h3 className="font-semibold">Checkout expired</h3>
              <p className="text-sm text-gray-500 mt-1">This checkout session has expired</p>
              <button onClick={() => setVerificationState('idle')} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded text-sm">Create New Checkout</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-md mx-auto">
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-xl font-bold mb-4">Secure Checkout</h2>
        <p className="text-sm text-gray-600 mb-4">You will be redirected to our secure payment provider. Your plan price is determined by backend catalog, never by frontend.</p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 mb-4">{error}</div>
        )}

        {checkout ? (
          <div className="space-y-3 text-sm">
            <p><span className="text-gray-500">Plan:</span> {checkout.planName} ({checkout.planCode})</p>
            <p><span className="text-gray-500">Amount:</span> {checkout.amount} {checkout.currency}</p>
            <p><span className="text-gray-500">Provider:</span> {checkout.provider}</p>
            <p><span className="text-gray-500">Status:</span> {checkout.status}</p>
            {checkout.checkoutUrl && (
              <a href={checkout.checkoutUrl} className="block mt-4 w-full text-center py-2 bg-blue-600 text-white rounded">Go to Provider Checkout</a>
            )}
          </div>
        ) : (
          <>
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800 mb-4">
              <p>🔒 Secure checkout via backend. Provider secrets never exposed to frontend.</p>
              <p className="mt-1">After payment, we verify actual payment state from backend - never trust URL params alone.</p>
            </div>
            <button
              onClick={handleCreateCheckout}
              disabled={loading}
              className="w-full py-3 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating secure checkout...' : 'Proceed to Secure Checkout'}
            </button>
            {onClose && (
              <button onClick={onClose} className="w-full mt-2 py-2 border rounded text-sm">Cancel</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

FILE: apps/admin-web/src/modules/billing/portal/plan-comparison.tsx

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { getPlanComparison, changePlan, createCheckoutSession } from './billing-portal-api';

/**
 * Dynamic plan comparison UI - fetches canonical plan/features/limits from backend.
 * No hardcoded prices or limits.
 */
export default function PlanComparisonPage() {
  const [comparison, setComparison] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchComparison = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPlanComparison();
      setComparison(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load plans');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComparison();
  }, []);

  const handleSelectPlan = async (planId: string) => {
    setActionLoading(planId);
    setMessage(null);
    try {
      const result = await changePlan({ planId, atPeriodEnd: false });
      if (result.requiresCheckout) {
        // Need checkout for upgrade
        setMessage(`Upgrade requires payment. Price delta: ${result.priceDelta}. Proceeding to checkout...`);
        const checkout = await createCheckoutSession({
          planId,
          successUrl: window.location.origin + '/billing?checkout_success=true',
          cancelUrl: window.location.origin + '/billing/plans',
        });
        if (checkout.checkoutUrl) {
          window.location.href = checkout.checkoutUrl;
          return;
        }
      }
      setMessage(result.message || 'Plan change successful');
      await fetchComparison();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="grid grid-cols-3 gap-4">
            <div className="h-64 bg-gray-200 rounded" />
            <div className="h-64 bg-gray-200 rounded" />
            <div className="h-64 bg-gray-200 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-800">{error}</p>
          <button onClick={fetchComparison} className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm">Retry</button>
        </div>
      </div>
    );
  }

  if (!comparison || !comparison.plans?.length) {
    return (
      <div className="p-6 text-center py-12">
        <p className="text-gray-500">No plans available</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Compare Plans</h1>
      <p className="text-gray-600">Choose the plan that fits your needs. All pricing from canonical billing catalog.</p>

      {message && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">{message}</div>
      )}

      {/* Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {comparison.plans.map((plan: any) => (
          <div key={plan.id} className={`border rounded-lg p-6 ${plan.isCurrent ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}`}>
            {plan.isCurrent && <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded mb-2">Current Plan</span>}
            <h3 className="text-xl font-bold">{plan.name}</h3>
            <p className="text-sm text-gray-500 mt-1">{plan.description || ''}</p>
            <div className="mt-4">
              <span className="text-3xl font-bold">{plan.price}</span>
              <span className="text-gray-500 ml-1">{plan.currency}</span>
              <span className="text-sm text-gray-400"> / {plan.interval}</span>
            </div>
            {plan.trialDays > 0 && <p className="text-xs text-green-600 mt-2">{plan.trialDays} day trial</p>}

            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium">Limits:</p>
              {Object.entries(plan.limits || {}).map(([key, value]: any) => {
                if (value === null || value === undefined) return null;
                if (typeof value === 'boolean') return null;
                return (
                  <div key={key} className="flex justify-between text-xs">
                    <span className="text-gray-600">{key.replace(/([A-Z])/g, ' $1')}</span>
                    <span className="font-medium">{value === null ? 'Unlimited' : String(value)}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-4">
              <p className="text-sm font-medium mb-1">Features:</p>
              <ul className="space-y-1">
                {(plan.features || []).slice(0, 5).map((f: string) => (
                  <li key={f} className="text-xs text-gray-600 flex items-center">
                    <span className="text-green-500 mr-1">✓</span> {f}
                  </li>
                ))}
                {plan.features?.length > 5 && <li className="text-xs text-gray-400">+{plan.features.length - 5} more</li>}
              </ul>
            </div>

            <div className="mt-6">
              {plan.isCurrent ? (
                <button disabled className="w-full py-2 bg-gray-100 text-gray-500 rounded text-sm cursor-not-allowed">Current Plan</button>
              ) : (
                <button
                  onClick={() => handleSelectPlan(plan.id)}
                  disabled={!!actionLoading}
                  className={`w-full py-2 rounded text-sm font-medium ${plan.upgradeEligible ? 'bg-blue-600 text-white hover:bg-blue-700' : plan.downgradeEligible ? 'bg-gray-800 text-white hover:bg-gray-900' : 'bg-white border border-gray-300 hover:bg-gray-50'}`}
                >
                  {actionLoading === plan.id ? 'Processing...' : plan.upgradeEligible ? 'Upgrade' : plan.downgradeEligible ? 'Downgrade' : 'Select Plan'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Features Matrix */}
      {comparison.featuresMatrix?.length > 0 && (
        <div className="bg-white border rounded-lg p-6 overflow-x-auto">
          <h3 className="font-semibold mb-4">Feature Comparison</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Feature</th>
                {comparison.plans.map((p: any) => (
                  <th key={p.id} className="text-center py-2">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.featuresMatrix.map((row: any) => (
                <tr key={row.featureKey} className="border-b">
                  <td className="py-2">{row.label}</td>
                  {comparison.plans.map((p: any) => (
                    <td key={p.id} className="text-center py-2">
                      {row.plans[p.id] ? <span className="text-green-600">✓</span> : <span className="text-gray-300">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Limits Matrix */}
      {comparison.limitsMatrix?.length > 0 && (
        <div className="bg-white border rounded-lg p-6 overflow-x-auto">
          <h3 className="font-semibold mb-4">Limits Comparison</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Limit</th>
                {comparison.plans.map((p: any) => (
                  <th key={p.id} className="text-center py-2">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.limitsMatrix.map((row: any) => (
                <tr key={row.limitKey} className="border-b">
                  <td className="py-2">{row.label}</td>
                  {comparison.plans.map((p: any) => (
                    <td key={p.id} className="text-center py-2">
                      {row.plans[p.id] === null ? 'Unlimited' : String(row.plans[p.id])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

FILE: apps/admin-web/src/modules/billing/portal/subscription-management.tsx

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import {
  getCurrentSubscription,
  getAvailablePlans,
  cancelSubscription,
  resumeSubscription,
  changePlan,
  changeInterval,
  createCheckoutSession,
} from './billing-portal-api';

/**
 * Admin-web subscription management UI.
 * All mutations via authenticated backend APIs, never direct frontend state mutation.
 */
export default function SubscriptionManagementPage() {
  const [subscriptionState, setSubscriptionState] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [subState, plansRes] = await Promise.all([getCurrentSubscription(), getAvailablePlans()]);
      setSubscriptionState(subState);
      setPlans(plansRes.plans || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load subscription');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCancel = async () => {
    setActionLoading('cancel');
    setMessage(null);
    try {
      const result = await cancelSubscription({ reason: cancelReason, atPeriodEnd: true });
      setMessage(`Subscription will cancel at ${result.effectiveAt ? new Date(result.effectiveAt).toLocaleDateString() : 'period end'}`);
      setShowCancelDialog(false);
      await fetchData();
    } catch (e: any) {
      setMessage(`Cancel failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleResume = async () => {
    setActionLoading('resume');
    setMessage(null);
    try {
      const result = await resumeSubscription();
      setMessage(result.message || 'Subscription resumed');
      await fetchData();
    } catch (e: any) {
      setMessage(`Resume failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangePlan = async (planId: string) => {
    setActionLoading(`plan_${planId}`);
    setMessage(null);
    try {
      const result = await changePlan({ planId, atPeriodEnd: false });
      if (result.requiresCheckout) {
        setMessage(`Upgrade requires checkout. Price delta: ${result.priceDelta}. Creating checkout...`);
        const checkout = await createCheckoutSession({
          planId,
          successUrl: window.location.origin + '/billing?checkout_success=true',
          cancelUrl: window.location.origin + '/billing/subscription',
        });
        if (checkout.checkoutUrl) {
          window.location.href = checkout.checkoutUrl;
          return;
        }
      }
      setMessage(result.message || 'Plan changed successfully');
      await fetchData();
    } catch (e: any) {
      setMessage(`Plan change failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangeInterval = async (newInterval: string) => {
    setActionLoading(`interval_${newInterval}`);
    setMessage(null);
    try {
      const result = await changeInterval({ newInterval, atPeriodEnd: true });
      setMessage(result.message || `Interval change to ${newInterval} scheduled`);
      await fetchData();
    } catch (e: any) {
      setMessage(`Interval change failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-32 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-800">{error}</p>
          <button onClick={fetchData} className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm">Retry</button>
        </div>
      </div>
    );
  }

  const sub = subscriptionState?.subscription;
  const canCancel = subscriptionState?.canCancel;
  const canResume = subscriptionState?.canResume;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Subscription Management</h1>

      {message && <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">{message}</div>}

      {/* Current State */}
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Current Subscription</h2>
        {sub ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Plan</p>
              <p className="font-medium">{sub.plan?.name || sub.planId}</p>
            </div>
            <div>
              <p className="text-gray-500">Status</p>
              <p className="font-medium">{sub.status}</p>
              {sub.cancelAtPeriodEnd && <p className="text-xs text-orange-600">Cancels at period end</p>}
            </div>
            <div>
              <p className="text-gray-500">Current Period End</p>
              <p className="font-medium">{sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : 'N/A'}</p>
            </div>
            <div>
              <p className="text-gray-500">Interval</p>
              <p className="font-medium">{sub.plan?.interval || 'N/A'}</p>
            </div>
            <div>
              <p className="text-gray-500">Seats</p>
              <p className="font-medium">{sub.seatsPurchased || 1}</p>
            </div>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No active subscription</p>
        )}
      </div>

      {/* Actions */}
      <div className="bg-white border rounded-lg p-6">
        <h3 className="font-semibold mb-4">Available Actions</h3>
        <div className="flex flex-wrap gap-3">
          {canCancel && (
            <button onClick={() => setShowCancelDialog(true)} disabled={!!actionLoading} className="px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50">
              Cancel at Period End
            </button>
          )}
          {canResume && (
            <button onClick={handleResume} disabled={!!actionLoading} className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50">
              {actionLoading === 'resume' ? 'Resuming...' : 'Resume Subscription'}
            </button>
          )}
          {subscriptionState?.effectiveActions?.map((action: string) => (
            <span key={action} className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-xs border">{action}</span>
          ))}
        </div>

        {showCancelDialog && (
          <div className="mt-6 border-t pt-4">
            <h4 className="font-medium mb-2">Confirm Cancellation</h4>
            <p className="text-sm text-gray-600 mb-3">Your subscription will remain active until the end of the current billing period.</p>
            <input
              type="text"
              placeholder="Reason (optional)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm mb-3"
            />
            <div className="flex gap-2">
              <button onClick={handleCancel} disabled={actionLoading === 'cancel'} className="px-4 py-2 bg-red-600 text-white rounded text-sm disabled:opacity-50">
                {actionLoading === 'cancel' ? 'Cancelling...' : 'Confirm Cancel at Period End'}
              </button>
              <button onClick={() => setShowCancelDialog(false)} className="px-4 py-2 border rounded text-sm">Keep Subscription</button>
            </div>
          </div>
        )}
      </div>

      {/* Change Plan */}
      <div className="bg-white border rounded-lg p-6">
        <h3 className="font-semibold mb-4">Change Plan</h3>
        <p className="text-sm text-gray-600 mb-4">All plan data from canonical catalog, no hardcoded pricing. Payment required for upgrades handled via secure checkout.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan: any) => (
            <div key={plan.id} className={`border rounded p-4 ${sub?.planId === plan.id ? 'border-blue-500 bg-blue-50' : ''}`}>
              <p className="font-medium">{plan.name}</p>
              <p className="text-sm text-gray-500">{plan.code} - {plan.interval}</p>
              <p className="text-lg font-bold mt-2">{plan.price} {plan.currency}</p>
              {sub?.planId !== plan.id ? (
                <button onClick={() => handleChangePlan(plan.id)} disabled={!!actionLoading} className="mt-3 w-full py-1.5 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
                  {actionLoading === `plan_${plan.id}` ? 'Processing...' : 'Change to this Plan'}
                </button>
              ) : (
                <span className="mt-3 block w-full text-center py-1.5 bg-gray-100 text-gray-500 rounded text-sm">Current</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Change Interval */}
      <div className="bg-white border rounded-lg p-6">
        <h3 className="font-semibold mb-4">Change Billing Interval</h3>
        <div className="flex gap-2">
          {['MONTHLY', 'QUARTERLY', 'YEARLY'].map((interval) => (
            <button
              key={interval}
              onClick={() => handleChangeInterval(interval)}
              disabled={!!actionLoading || sub?.plan?.interval === interval}
              className={`px-4 py-2 rounded text-sm ${sub?.plan?.interval === interval ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white border hover:bg-gray-50'}`}
            >
              {actionLoading === `interval_${interval}` ? '...' : interval}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">Interval changes take effect at period end per existing subscription semantics</p>
      </div>
    </div>
  );
}
```

FILE: apps/admin-web/src/modules/billing/saas-admin/saas-admin-api.ts

```typescript
/**
 * SaaS Admin Control Plane API client.
 * Authenticated, tenant/admin scoped, no secrets, no direct DB calls.
 */

import { apiClient } from '@/lib/api-client';

const PROXY_PREFIX = '/api/proxy';
const API_BASE = `${PROXY_PREFIX}/billing/saas-admin`;

/**
 * All calls go through the console's same-origin proxy (/api/proxy/* ->
 * API_BASE_URL/v1/*): the bearer token lives in an httpOnly cookie that only
 * the proxy can read, and mutations carry the CSRF header. Before this the
 * module fetched `{API_BASE}` on the admin origin, which has no such route, so
 * every call 404'd. apiClient also unwraps the {success, data} envelope, which
 * is the shape the billing components read (e.g. `result.tenantSlug`).
 */
async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const path = url.startsWith(PROXY_PREFIX) ? url.slice(PROXY_PREFIX.length) : url;
  const method = (options?.method ?? 'GET').toUpperCase();
  const body =
    typeof options?.body === 'string' && options.body.length > 0 ? JSON.parse(options.body) : undefined;
  switch (method) {
    case 'POST':
      return apiClient.post(path, body);
    case 'PATCH':
      return apiClient.patch(path, body);
    case 'PUT':
      return apiClient.put(path, body);
    case 'DELETE':
      return apiClient.delete(path, body === undefined ? {} : { body });
    default:
      return apiClient.get(path);
  }
}

// Tenants
export async function listTenants(params?: { status?: string; planCode?: string; search?: string; page?: number; limit?: number }): Promise<any> {
  const q = new URLSearchParams();
  if (params?.status) q.append('status', params.status);
  if (params?.planCode) q.append('planCode', params.planCode);
  if (params?.search) q.append('search', params.search);
  if (params?.page) q.append('page', String(params.page));
  if (params?.limit) q.append('limit', String(params.limit));
  return fetchJson(`${API_BASE}/tenants?${q.toString()}`);
}

export async function getTenantDetail(id: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${id}`);
}

export async function provisionTenant(payload: { slug: string; name: string; legalName?: string; contactEmail?: string; countryCode?: string; defaultCurrency?: string; planId?: string; billingEmail?: string; billingName?: string; idempotencyKey?: string }): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/provision`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getTenantSubscription(id: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${id}/subscription`);
}

// Plans
export async function assignPlan(tenantId: string, planId: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/plan/assign`, {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });
}

export async function changePlan(tenantId: string, planId: string, atPeriodEnd?: boolean): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/plan/change`, {
    method: 'POST',
    body: JSON.stringify({ planId, atPeriodEnd }),
  });
}

export async function changeInterval(tenantId: string, newInterval: string, atPeriodEnd?: boolean): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/plan/change-interval`, {
    method: 'POST',
    body: JSON.stringify({ newInterval, atPeriodEnd }),
  });
}

// Feature access
export async function getFeatureAccess(tenantId: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/feature-access`);
}

export async function checkFeature(tenantId: string, featureKey: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/feature-access/${featureKey}`);
}

// Branding
export async function getBranding(tenantId: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/branding`);
}

export async function updateBranding(tenantId: string, payload: Record<string, any>): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/branding`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Custom domains
export async function listDomains(tenantId: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/domains`);
}

export async function getDomainStatus(tenantId: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/domains/status`);
}

export async function registerDomain(tenantId: string, domain: string, isPrimary?: boolean): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/domains/register`, {
    method: 'POST',
    body: JSON.stringify({ domain, isPrimary }),
  });
}

export async function generateVerificationChallenge(tenantId: string, domain: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/domains/verification-challenge`, {
    method: 'POST',
    body: JSON.stringify({ domain }),
  });
}

export async function verifyDomain(tenantId: string, domain: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/domains/verify`, {
    method: 'POST',
    body: JSON.stringify({ domain }),
  });
}

export async function getVerificationStatus(tenantId: string, domain: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/domains/${encodeURIComponent(domain)}/verification-status`);
}

export async function removeDomain(tenantId: string, domain: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/domains`, {
    method: 'DELETE',
    body: JSON.stringify({ domain }),
  });
}

// White-label
export async function getWhiteLabelState(tenantId: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/white-label`);
}

export async function requestWhiteLabel(tenantId: string, configuration?: Record<string, any>): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/white-label/request`, {
    method: 'POST',
    body: JSON.stringify({ configuration }),
  });
}

export async function enableWhiteLabel(tenantId: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/white-label/enable`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function disableWhiteLabel(tenantId: string, reason?: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/white-label/disable`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

// Canonical plan catalog for UI - no hardcoded pricing.
// GET /v1/billing/plans through the proxy (the former raw fetch of
// /api/v1/billing/plans hit the admin origin, which has no such route, so the
// plan list was always empty). Only purchasable (active) plans are offered
// for assignment, which is the API default (ListPlansDto.includeInactive =
// false); the client-side filter is a belt-and-braces check, and the API
// refuses an inactive plan anyway.
export async function getPlanCatalog(): Promise<any> {
  const page = await apiClient.get<{ items: any[]; pagination: unknown }>('/billing/plans', {
    searchParams: { limit: 100, sortBy: 'sortOrder', sortOrder: 'asc' },
  });
  return { ...page, items: (page.items ?? []).filter((plan: any) => plan.isActive !== false) };
}
```

FILE: apps/admin-web/src/modules/billing/saas-admin/saas-plan-management.tsx

```tsx
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  getTenantDetail,
  assignPlan,
  changePlan,
  changeInterval,
  getPlanCatalog,
} from './saas-admin-api';

/**
 * Admin plan-management UI using canonical plan catalog and existing
 * subscription/payment flows; no direct DB mutation.
 * No hardcoded prices.
 */
export default function SaasPlanManagementPage({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [atPeriodEnd, setAtPeriodEnd] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantRes, plansRes] = await Promise.all([getTenantDetail(tenantId), getPlanCatalog()]);
      setTenant(tenantRes);
      setPlans(plansRes.items || plansRes.plans || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleAssign = async () => {
    if (!selectedPlanId) return;
    setActionLoading('assign');
    setMessage(null);
    try {
      const result = await assignPlan(tenantId, selectedPlanId);
      setMessage(`Plan assigned: ${result.message}`);
      await fetchData();
    } catch (e: any) {
      setMessage(`Assign failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangePlan = async (planId: string) => {
    setActionLoading(`change_${planId}`);
    setMessage(null);
    try {
      const result = await changePlan(tenantId, planId, atPeriodEnd);
      if (result.requiresCheckout) {
        setMessage(`Upgrade requires checkout: ${result.checkout?.checkoutUrl || ''} Price delta: ${result.priceDelta}`);
        if (result.checkout?.checkoutUrl) {
          window.open(result.checkout.checkoutUrl, '_blank');
        }
      } else {
        setMessage(`Plan changed: ${result.message} Effective: ${result.effectiveAt ? new Date(result.effectiveAt).toLocaleDateString() : 'now'}`);
      }
      await fetchData();
    } catch (e: any) {
      setMessage(`Change failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangeInterval = async (newInterval: string) => {
    setActionLoading(`interval_${newInterval}`);
    setMessage(null);
    try {
      const result = await changeInterval(tenantId, newInterval, true);
      setMessage(`Interval change: ${result.message}`);
      await fetchData();
    } catch (e: any) {
      setMessage(`Interval change failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-32 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-800">{error}</p>
          <button onClick={fetchData} className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm">Retry</button>
        </div>
      </div>
    );
  }

  const currentPlanId = tenant?.subscriptionSummary?.planId;
  const currentPlanCode = tenant?.subscriptionSummary?.planCode;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">Plan Management - Tenant: {tenant?.name || tenantId}</h1>
      <p className="text-sm text-gray-500">All plan data from canonical backend catalog. No direct subscription.planId mutation. All changes via existing billing services.</p>

      {message && <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">{message}</div>}

      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-medium mb-2">Current Plan</h3>
        {tenant?.subscriptionSummary ? (
          <div className="text-sm space-y-1">
            <p><span className="text-gray-500">Plan:</span> {tenant.subscriptionSummary.planName} ({tenant.subscriptionSummary.planCode})</p>
            <p><span className="text-gray-500">Status:</span> {tenant.subscriptionSummary.status}</p>
            <p><span className="text-gray-500">Interval:</span> {tenant.subscriptionSummary.interval}</p>
            <p><span className="text-gray-500">Renewal:</span> {tenant.subscriptionSummary.renewalDate ? new Date(tenant.subscriptionSummary.renewalDate).toLocaleDateString() : 'N/A'}</p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No active subscription - assign initial plan</p>
        )}
      </div>

      {!tenant?.subscriptionSummary && (
        <div className="bg-white border rounded-lg p-4">
          <h3 className="font-medium mb-3">Assign Initial Plan</h3>
          <div className="flex gap-2">
            <select value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)} className="flex-1 border rounded px-3 py-2 text-sm">
              <option value="">Select plan</option>
              {plans.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name} - {p.code} - {p.price} {p.currency} / {p.interval}</option>
              ))}
            </select>
            <button onClick={handleAssign} disabled={!selectedPlanId || actionLoading === 'assign'} className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
              {actionLoading === 'assign' ? 'Assigning...' : 'Assign Plan'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">Uses existing subscription logic, not direct DB mutation</p>
        </div>
      )}

      <div className="bg-white border rounded-lg p-4">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-medium">Available Plans (Canonical Catalog)</h3>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={atPeriodEnd} onChange={(e) => setAtPeriodEnd(e.target.checked)} />
            At period end
          </label>
        </div>
        <p className="text-xs text-gray-500 mb-3">Price, currency, interval, features, limits from backend. No hardcoded Basic/Standard/Premium prices.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan: any) => (
            <div key={plan.id} className={`border rounded p-4 ${currentPlanId === plan.id ? 'border-blue-500 bg-blue-50' : ''}`}>
              <p className="font-medium">{plan.name}</p>
              <p className="text-xs text-gray-500">{plan.code} - {plan.interval}</p>
              <p className="text-xl font-bold mt-2">{plan.price} {plan.currency}</p>
              <p className="text-xs text-gray-400">/ {plan.interval} {plan.trialDays > 0 ? `(${plan.trialDays}d trial)` : ''}</p>

              <div className="mt-3 space-y-1">
                <p className="text-xs font-medium">Limits:</p>
                {Object.entries(plan.limits || {}).filter(([k, v]) => v !== null && typeof v !== 'boolean').slice(0, 4).map(([k, v]: any) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-gray-600">{k}</span>
                    <span className="font-medium">{v === null ? 'Unlimited' : String(v)}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3">
                <p className="text-xs font-medium">Features:</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(plan.features || []).slice(0, 3).map((f: string) => (
                    <span key={f} className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">{f}</span>
                  ))}
                  {plan.features?.length > 3 && <span className="text-xs text-gray-400">+{plan.features.length - 3}</span>}
                </div>
              </div>

              <div className="mt-4">
                {currentPlanId === plan.id ? (
                  <span className="block text-center py-1.5 bg-gray-100 text-gray-500 rounded text-sm">Current Plan</span>
                ) : (
                  <button onClick={() => handleChangePlan(plan.id)} disabled={!!actionLoading} className="w-full py-1.5 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
                    {actionLoading === `change_${plan.id}` ? 'Processing...' : currentPlanCode === plan.code ? 'Change Interval' : 'Change to this Plan'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-medium mb-3">Change Billing Interval</h3>
        <div className="flex gap-2">
          {['MONTHLY', 'QUARTERLY', 'YEARLY', 'LIFETIME'].map((interval) => (
            <button key={interval} onClick={() => handleChangeInterval(interval)} disabled={!!actionLoading || tenant?.subscriptionSummary?.interval === interval} className={`px-3 py-2 rounded text-sm ${tenant?.subscriptionSummary?.interval === interval ? 'bg-gray-100 text-gray-400' : 'bg-white border hover:bg-gray-50'}`}>
              {actionLoading === `interval_${interval}` ? '...' : interval}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">Uses existing subscription/payment architecture, no direct planId mutation</p>
      </div>
    </div>
  );
}
```

FILE: apps/admin-web/src/modules/billing/saas-admin/saas-tenant-management.tsx

```tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  listTenants,
  getTenantDetail,
  provisionTenant,
  getPlanCatalog,
} from './saas-admin-api';

/**
 * SaaS tenant management screen: tenant status, plan, billing, usage,
 * entitlements, branding, domain, white-label, admin actions.
 * All from backend APIs, no hardcoded pricing.
 */
export default function SaasTenantManagementPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedTenant, setSelectedTenant] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showProvision, setShowProvision] = useState(false);
  const [provisionForm, setProvisionForm] = useState({ slug: '', name: '', contactEmail: '', planId: '' });
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The list loads on mount and on search submit, not on every keystroke:
  // fetchTenants reads the current search term from a ref.
  const searchRef = useRef(search);
  searchRef.current = search;

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantsRes, plansRes] = await Promise.all([listTenants({ search: searchRef.current || undefined, limit: 50 }), getPlanCatalog().catch(() => ({ items: [] }))]);
      setTenants(tenantsRes.items || []);
      setTotal(tenantsRes.total || 0);
      setPlans(plansRes.items || plansRes.plans || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load tenants');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTenants();
  }, [fetchTenants]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTenants();
  };

  const handleSelectTenant = async (tenantId: string) => {
    try {
      const detail = await getTenantDetail(tenantId);
      setSelectedTenant(detail);
    } catch (e: any) {
      setMessage(`Failed to load tenant detail: ${e.message}`);
    }
  };

  const handleProvision = async () => {
    setProvisionLoading(true);
    setMessage(null);
    try {
      const result = await provisionTenant({
        slug: provisionForm.slug,
        name: provisionForm.name,
        contactEmail: provisionForm.contactEmail || undefined,
        planId: provisionForm.planId || undefined,
        idempotencyKey: `provision_${provisionForm.slug}_${Date.now()}`,
      });
      setMessage(`Tenant provisioned: ${result.tenantSlug} (${result.tenantId}) ${result.idempotent ? '[idempotent]' : ''}`);
      setShowProvision(false);
      setProvisionForm({ slug: '', name: '', contactEmail: '', planId: '' });
      await fetchTenants();
    } catch (e: any) {
      setMessage(`Provision failed: ${e.message}`);
    } finally {
      setProvisionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">SaaS Tenant Management</h1>
        <button onClick={() => setShowProvision(true)} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">Provision Tenant</button>
      </div>

      {message && <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">{message}</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">{error}</div>}

      <form onSubmit={handleSearch} className="flex gap-2">
        <input type="text" placeholder="Search tenants..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 border rounded px-3 py-2 text-sm" />
        <button type="submit" className="px-4 py-2 bg-gray-800 text-white rounded text-sm">Search</button>
        <button type="button" onClick={fetchTenants} className="px-3 py-2 border rounded text-sm">Refresh</button>
      </form>

      <div className="bg-white border rounded-lg p-4">
        <p className="text-sm text-gray-500 mb-3">Total tenants: {total}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Slug</th>
                <th className="py-2">Name</th>
                <th className="py-2">Status</th>
                <th className="py-2">Plan</th>
                <th className="py-2">Lifecycle</th>
                <th className="py-2">Provisioning</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t: any) => (
                <tr key={t.id} className="border-b hover:bg-gray-50">
                  <td className="py-2 font-mono text-xs">{t.slug}</td>
                  <td className="py-2">{t.name}</td>
                  <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs ${t.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{t.status}</span></td>
                  <td className="py-2">{t.subscriptionSummary?.planCode || 'No plan'}</td>
                  <td className="py-2 text-xs">{t.lifecycleState}</td>
                  <td className="py-2 text-xs">{t.provisioningState}</td>
                  <td className="py-2"><button onClick={() => handleSelectTenant(t.id)} className="text-blue-600 hover:underline text-xs">View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedTenant && (
        <div className="bg-white border rounded-lg p-6 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Tenant Detail: {selectedTenant.name} ({selectedTenant.slug})</h2>
            <div className="flex gap-3 items-center">
              <a href={`/saas-admin/tenants/${encodeURIComponent(selectedTenant.id)}`} className="text-sm text-blue-600 hover:underline">Manage plan, branding, domains &amp; entitlements</a>
              <button onClick={() => setSelectedTenant(null)} className="text-sm text-gray-500">Close</button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><p className="text-gray-500">ID</p><p className="font-mono text-xs">{selectedTenant.id}</p></div>
            <div><p className="text-gray-500">Status</p><p className="font-medium">{selectedTenant.status}</p></div>
            <div><p className="text-gray-500">Plan</p><p className="font-medium">{selectedTenant.subscriptionSummary?.planName || 'None'} ({selectedTenant.subscriptionSummary?.planCode || '-'})</p></div>
            <div><p className="text-gray-500">Interval</p><p className="font-medium">{selectedTenant.subscriptionSummary?.interval || 'N/A'}</p></div>
            <div><p className="text-gray-500">Subscription Status</p><p className="font-medium">{selectedTenant.subscriptionSummary?.status || 'None'}</p></div>
            <div><p className="text-gray-500">Renewal</p><p className="font-medium">{selectedTenant.subscriptionSummary?.renewalDate ? new Date(selectedTenant.subscriptionSummary.renewalDate).toLocaleDateString() : 'N/A'}</p></div>
            <div><p className="text-gray-500">Lifecycle</p><p className="font-medium">{selectedTenant.lifecycleState}</p></div>
            <div><p className="text-gray-500">Provisioning</p><p className="font-medium">{selectedTenant.provisioningState}</p></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-medium mb-2">Effective Features (canonical entitlement)</h3>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {(selectedTenant.entitlements || []).map((e: any) => (
                  <div key={e.featureKey} className="flex justify-between text-xs border-b py-1">
                    <span>{e.featureKey}</span>
                    <span className={e.enabled ? 'text-green-600' : 'text-gray-400'}>{e.enabled ? '✓ Enabled' : '✗ Disabled'}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-medium mb-2">Limits (canonical plan limits)</h3>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {(selectedTenant.limits || []).map((l: any) => (
                  <div key={l.limitKey} className="flex justify-between text-xs border-b py-1">
                    <span>{l.limitKey}</span>
                    <span>{l.unlimited ? 'Unlimited' : `${l.currentUsage}/${l.configuredLimit} (${l.remaining} remain)`}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border rounded p-3">
              <h4 className="font-medium text-sm mb-2">Branding</h4>
              {selectedTenant.brandingState ? (
                <div className="text-xs space-y-1">
                  <p>App: {selectedTenant.brandingState.appName}</p>
                  <p>Primary: {selectedTenant.brandingState.primaryColor}</p>
                  <p>Logo: {selectedTenant.brandingState.logoUrl ? 'Set' : 'Not set'}</p>
                  <p>Custom CSS: {selectedTenant.brandingState.hasCustomCss ? 'Yes' : 'No'}</p>
                </div>
              ) : <p className="text-xs text-gray-500">No branding</p>}
            </div>
            <div className="border rounded p-3">
              <h4 className="font-medium text-sm mb-2">Custom Domain</h4>
              {selectedTenant.customDomainState ? (
                <div className="text-xs space-y-1">
                  <p>Domain: {selectedTenant.customDomainState.domain || 'None'}</p>
                  <p>Status: {selectedTenant.customDomainState.status || 'N/A'}</p>
                  <p>Entitlement: {selectedTenant.customDomainState.entitlementAllowed ? 'Allowed' : `Blocked: ${selectedTenant.customDomainState.entitlementReason}`}</p>
                  <p>Verification: {selectedTenant.customDomainState.verificationRequired ? 'Required' : 'Done'}</p>
                </div>
              ) : <p className="text-xs text-gray-500">No domain state</p>}
            </div>
            <div className="border rounded p-3">
              <h4 className="font-medium text-sm mb-2">White-Label</h4>
              {selectedTenant.whiteLabelState ? (
                <div className="text-xs space-y-1">
                  <p>Eligible: {selectedTenant.whiteLabelState.eligible ? 'Yes' : 'No'}</p>
                  <p>State: {selectedTenant.whiteLabelState.provisioningState}</p>
                  <p>Entitlement: {selectedTenant.whiteLabelState.entitlementAllowed ? 'Allowed' : `Blocked: ${selectedTenant.whiteLabelState.entitlementReason}`}</p>
                  <p>Requested: {selectedTenant.whiteLabelState.requestedAt ? new Date(selectedTenant.whiteLabelState.requestedAt).toLocaleDateString() : 'Never'}</p>
                </div>
              ) : <p className="text-xs text-gray-500">No white-label state</p>}
            </div>
          </div>

          <div>
            <h3 className="font-medium mb-2">Domains</h3>
            <div className="text-xs space-y-1">
              {(selectedTenant.domains || []).map((d: any) => (
                <div key={d.id} className="flex justify-between border-b py-1">
                  <span>{d.domain} {d.isPrimary ? '(primary)' : ''}</span>
                  <span className={d.status === 'ACTIVE' ? 'text-green-600' : 'text-yellow-600'}>{d.status}</span>
                </div>
              ))}
              {(!selectedTenant.domains || selectedTenant.domains.length === 0) && <p className="text-gray-500">No domains</p>}
            </div>
          </div>

          <div>
            <h3 className="font-medium mb-2">Available Admin Actions</h3>
            <div className="flex flex-wrap gap-2">
              {(selectedTenant.availableActions || []).map((a: string) => (
                <span key={a} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs border border-blue-200">{a.replace(/_/g, ' ')}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {showProvision && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="font-semibold mb-4">Provision Tenant - Idempotent</h3>
            <div className="space-y-3">
              <input type="text" placeholder="Slug (e.g., acme-capital)" value={provisionForm.slug} onChange={(e) => setProvisionForm({ ...provisionForm, slug: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              <input type="text" placeholder="Name (e.g., Acme Capital)" value={provisionForm.name} onChange={(e) => setProvisionForm({ ...provisionForm, name: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              <input type="email" placeholder="Contact Email" value={provisionForm.contactEmail} onChange={(e) => setProvisionForm({ ...provisionForm, contactEmail: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              <select value={provisionForm.planId} onChange={(e) => setProvisionForm({ ...provisionForm, planId: e.target.value })} className="w-full border rounded px-3 py-2 text-sm">
                <option value="">No plan (assign later)</option>
                {plans.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name} - {p.code} - {p.price} {p.currency} / {p.interval}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500">Plan pricing from canonical catalog, never hardcoded. Provisioning is idempotent - duplicate slug returns existing.</p>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={handleProvision} disabled={provisionLoading || !provisionForm.slug || !provisionForm.name} className="flex-1 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
                {provisionLoading ? 'Provisioning...' : 'Provision'}
              </button>
              <button onClick={() => setShowProvision(false)} className="flex-1 py-2 border rounded text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

FILE: apps/admin-web/src/modules/billing/saas-admin/tenant-branding-domain.tsx

```tsx
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  getTenantDetail,
  getBranding,
  updateBranding,
  listDomains,
  registerDomain,
  generateVerificationChallenge,
  verifyDomain,
  removeDomain,
  getWhiteLabelState,
  requestWhiteLabel,
  enableWhiteLabel,
  disableWhiteLabel,
  getFeatureAccess,
} from './saas-admin-api';

/**
 * Tenant branding + custom-domain control UI.
 * Entitlement-aware controls and domain verification status.
 * Disables or explains unavailable features based on backend entitlement.
 */
export default function TenantBrandingDomainPage({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<any>(null);
  const [branding, setBranding] = useState<any>(null);
  const [domains, setDomains] = useState<any[]>([]);
  const [domainState, setDomainState] = useState<any>(null);
  const [whiteLabel, setWhiteLabel] = useState<any>(null);
  const [featureAccess, setFeatureAccess] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [brandingForm, setBrandingForm] = useState<any>({});
  const [domainInput, setDomainInput] = useState('');
  const [verificationChallenge, setVerificationChallenge] = useState<any>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantRes, brandingRes, domainsRes, wlRes, faRes] = await Promise.all([
        getTenantDetail(tenantId),
        getBranding(tenantId).catch(() => null),
        listDomains(tenantId).catch(() => ({ domains: [], currentState: null })),
        getWhiteLabelState(tenantId).catch(() => null),
        getFeatureAccess(tenantId).catch(() => null),
      ]);
      setTenant(tenantRes);
      setBranding(brandingRes);
      setDomains(domainsRes.domains || []);
      setDomainState(domainsRes.currentState || null);
      setWhiteLabel(wlRes);
      setFeatureAccess(faRes);
      if (brandingRes) {
        setBrandingForm({
          appName: brandingRes.appName || '',
          logoUrl: brandingRes.logoUrl || '',
          primaryColor: brandingRes.primaryColor || '#1B2A4A',
          secondaryColor: brandingRes.secondaryColor || '#0F172A',
          accentColor: brandingRes.accentColor || '#22C55E',
          supportEmail: brandingRes.supportEmail || '',
        });
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleBrandingUpdate = async () => {
    setActionLoading('branding');
    setMessage(null);
    try {
      const payload: any = {};
      if (brandingForm.appName) payload.appName = brandingForm.appName;
      if (brandingForm.logoUrl) payload.logoUrl = brandingForm.logoUrl;
      if (brandingForm.primaryColor) payload.primaryColor = brandingForm.primaryColor;
      if (brandingForm.secondaryColor) payload.secondaryColor = brandingForm.secondaryColor;
      if (brandingForm.accentColor) payload.accentColor = brandingForm.accentColor;
      if (brandingForm.supportEmail) payload.supportEmail = brandingForm.supportEmail;

      const result = await updateBranding(tenantId, payload);
      setMessage(`Branding updated: ${result.message || 'success'}`);
      await fetchData();
    } catch (e: any) {
      setMessage(`Branding update failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRegisterDomain = async () => {
    if (!domainInput) return;
    setActionLoading('register_domain');
    setMessage(null);
    try {
      const result = await registerDomain(tenantId, domainInput, true);
      setMessage(`Domain registered: ${result.domain} - ${result.message}`);
      setDomainInput('');
      await fetchData();
    } catch (e: any) {
      setMessage(`Domain registration failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleGenerateChallenge = async (domain: string) => {
    setActionLoading(`challenge_${domain}`);
    setMessage(null);
    try {
      const challenge = await generateVerificationChallenge(tenantId, domain);
      setVerificationChallenge(challenge);
      setMessage(`Challenge generated: ${challenge.message || ''} Record: ${challenge.verificationRecord || ''}`);
    } catch (e: any) {
      setMessage(`Challenge generation failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleVerifyDomain = async (domain: string) => {
    setActionLoading(`verify_${domain}`);
    setMessage(null);
    try {
      const result = await verifyDomain(tenantId, domain);
      setMessage(`Verification: ${result.status} - verified: ${result.verified} ${result.failureReason || ''}`);
      await fetchData();
    } catch (e: any) {
      setMessage(`Verification failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveDomain = async (domain: string) => {
    if (!confirm(`Remove domain ${domain}?`)) return;
    setActionLoading(`remove_${domain}`);
    setMessage(null);
    try {
      await removeDomain(tenantId, domain);
      setMessage(`Domain ${domain} removed`);
      await fetchData();
    } catch (e: any) {
      setMessage(`Remove failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRequestWhiteLabel = async () => {
    setActionLoading('wl_request');
    setMessage(null);
    try {
      const result = await requestWhiteLabel(tenantId, { requestedAt: new Date().toISOString() });
      setMessage(`White-label requested: ${result.provisioningState}`);
      await fetchData();
    } catch (e: any) {
      setMessage(`White-label request failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleEnableWhiteLabel = async () => {
    setActionLoading('wl_enable');
    setMessage(null);
    try {
      const result = await enableWhiteLabel(tenantId);
      setMessage(`White-label enabled: ${result.provisioningState}`);
      await fetchData();
    } catch (e: any) {
      setMessage(`White-label enable failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDisableWhiteLabel = async () => {
    setActionLoading('wl_disable');
    setMessage(null);
    try {
      const result = await disableWhiteLabel(tenantId, 'Admin disabled');
      setMessage(`White-label disabled: ${result.provisioningState}`);
      await fetchData();
    } catch (e: any) {
      setMessage(`White-label disable failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-32 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-800">{error}</p>
          <button onClick={fetchData} className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm">Retry</button>
        </div>
      </div>
    );
  }

  const customDomainAllowed = featureAccess?.features?.find((f: any) => f.featureKey === 'customDomain')?.enabled ?? domainState?.entitlementAllowed ?? false;
  const customDomainReason = featureAccess?.features?.find((f: any) => f.featureKey === 'customDomain')?.reason || domainState?.entitlementReason;
  const whiteLabelAllowed = featureAccess?.features?.find((f: any) => f.featureKey === 'whiteLabelMobileApp')?.enabled ?? whiteLabel?.entitlementAllowed ?? false;
  const whiteLabelReason = featureAccess?.features?.find((f: any) => f.featureKey === 'whiteLabelMobileApp')?.reason || whiteLabel?.entitlementReason;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">Branding & Domains - {tenant?.name || tenantId}</h1>
      <p className="text-sm text-gray-500">Branding uses existing sanitization. Custom domain requires customDomain entitlement. White-label requires whiteLabelMobileApp entitlement.</p>

      {message && <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">{message}</div>}

      {/* Branding */}
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Tenant Branding</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">App Name</label>
            <input type="text" value={brandingForm.appName || ''} onChange={(e) => setBrandingForm({ ...brandingForm, appName: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" maxLength={64} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Logo URL</label>
            <input type="url" value={brandingForm.logoUrl || ''} onChange={(e) => setBrandingForm({ ...brandingForm, logoUrl: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Primary Color</label>
            <input type="text" value={brandingForm.primaryColor || ''} onChange={(e) => setBrandingForm({ ...brandingForm, primaryColor: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" placeholder="#1B2A4A" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Secondary Color</label>
            <input type="text" value={brandingForm.secondaryColor || ''} onChange={(e) => setBrandingForm({ ...brandingForm, secondaryColor: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" placeholder="#0F172A" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Accent Color</label>
            <input type="text" value={brandingForm.accentColor || ''} onChange={(e) => setBrandingForm({ ...brandingForm, accentColor: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" placeholder="#22C55E" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Support Email</label>
            <input type="email" value={brandingForm.supportEmail || ''} onChange={(e) => setBrandingForm({ ...brandingForm, supportEmail: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3">Custom CSS sanitized server-side: @import, url(), script vectors removed. No arbitrary unsafe HTML.</p>
        <button onClick={handleBrandingUpdate} disabled={actionLoading === 'branding'} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
          {actionLoading === 'branding' ? 'Updating...' : 'Update Branding'}
        </button>

        {branding && (
          <div className="mt-4 border-t pt-3 text-xs space-y-1">
            <p><span className="text-gray-500">Current:</span> {branding.appName} - {branding.primaryColor}</p>
            <p><span className="text-gray-500">Updated:</span> {branding.updatedAt ? new Date(branding.updatedAt).toLocaleString() : 'Never'}</p>
          </div>
        )}
      </div>

      {/* Custom Domain */}
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-2">Custom Domain</h2>
        {!customDomainAllowed ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm">
            <p className="text-yellow-800 font-medium">Custom domain not allowed</p>
            <p className="text-yellow-700 text-xs mt-1">{customDomainReason || 'Feature not included in current plan - requires customDomain entitlement'}</p>
            <p className="text-xs text-gray-500 mt-2">Entitlement check: Tenant → Subscription → Plan → Entitlement Resolver → Feature Guard → Reject</p>
          </div>
        ) : (
          <>
            <div className="flex gap-2 mb-4">
              <input type="text" placeholder="app.example.com" value={domainInput} onChange={(e) => setDomainInput(e.target.value)} className="flex-1 border rounded px-3 py-2 text-sm" />
              <button onClick={handleRegisterDomain} disabled={!domainInput || actionLoading === 'register_domain'} className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
                {actionLoading === 'register_domain' ? 'Registering...' : 'Register Domain'}
              </button>
            </div>

            <div className="space-y-2">
              {domains.map((d: any) => (
                <div key={d.id} className="border rounded p-3 flex justify-between items-center">
                  <div className="text-sm">
                    <p className="font-medium">{d.domain} {d.isPrimary ? '(primary)' : ''}</p>
                    <p className="text-xs text-gray-500">Status: <span className={d.status === 'ACTIVE' ? 'text-green-600' : 'text-yellow-600'}>{d.status}</span> {d.verifiedAt ? `Verified: ${new Date(d.verifiedAt).toLocaleDateString()}` : 'Not verified'}</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => handleGenerateChallenge(d.domain)} disabled={!!actionLoading} className="px-2 py-1 border rounded text-xs">Challenge</button>
                    <button onClick={() => handleVerifyDomain(d.domain)} disabled={!!actionLoading} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Verify</button>
                    <button onClick={() => handleRemoveDomain(d.domain)} disabled={!!actionLoading} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Remove</button>
                  </div>
                </div>
              ))}
              {domains.length === 0 && <p className="text-sm text-gray-500">No custom domains registered</p>}
            </div>

            {verificationChallenge && (
              <div className="mt-4 bg-gray-50 border rounded p-3 text-xs">
                <p className="font-medium">Verification Challenge for {verificationChallenge.domain}</p>
                <p className="mt-1">Type: {verificationChallenge.verificationType}</p>
                <p>Record: {verificationChallenge.verificationRecord}</p>
                <p>Token: {verificationChallenge.token}</p>
                <p>Expires: {verificationChallenge.expiresAt ? new Date(verificationChallenge.expiresAt).toLocaleString() : ''}</p>
                <p className="mt-2 text-gray-600">{verificationChallenge.message}</p>
                <p className="mt-1">Add TXT record: _wlct-challenge.{verificationChallenge.domain} → {verificationChallenge.verificationRecord}</p>
              </div>
            )}

            {domainState && (
              <div className="mt-4 text-xs border-t pt-3">
                <p>Current State: {domainState.domain || 'None'} - {domainState.status || 'N/A'}</p>
                <p>Verification Required: {domainState.verificationRequired ? 'Yes' : 'No'}</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* White-Label */}
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-2">White-Label Mobile App</h2>
        {!whiteLabelAllowed ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm">
            <p className="text-yellow-800 font-medium">White-label not allowed</p>
            <p className="text-yellow-700 text-xs mt-1">{whiteLabelReason || 'Requires whiteLabelMobileApp entitlement'}</p>
            <p className="text-xs text-gray-500 mt-2">White-label remains commercial entitlement. Not enabled merely by admin click.</p>
          </div>
        ) : (
          <>
            <div className="text-sm space-y-1 mb-4">
              <p><span className="text-gray-500">Eligible:</span> {whiteLabel?.eligible ? 'Yes' : 'No'}</p>
              <p><span className="text-gray-500">State:</span> {whiteLabel?.provisioningState || 'NOT_REQUESTED'}</p>
              <p><span className="text-gray-500">Requested:</span> {whiteLabel?.requestedAt ? new Date(whiteLabel.requestedAt).toLocaleString() : 'Never'}</p>
              <p><span className="text-gray-500">Enabled:</span> {whiteLabel?.enabledAt ? new Date(whiteLabel.enabledAt).toLocaleString() : 'Not yet'}</p>
            </div>
            <div className="flex gap-2">
              {(whiteLabel?.provisioningState === 'NOT_REQUESTED' || !whiteLabel?.provisioningState) && (
                <button onClick={handleRequestWhiteLabel} disabled={actionLoading === 'wl_request'} className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
                  {actionLoading === 'wl_request' ? 'Requesting...' : 'Request White-Label'}
                </button>
              )}
              {whiteLabel?.provisioningState === 'REQUESTED' && (
                <button onClick={handleEnableWhiteLabel} disabled={actionLoading === 'wl_enable'} className="px-4 py-2 bg-green-600 text-white rounded text-sm disabled:opacity-50">
                  {actionLoading === 'wl_enable' ? 'Enabling...' : 'Enable White-Label (Entitlement Check)'}
                </button>
              )}
              {whiteLabel?.provisioningState === 'ACTIVE' && (
                <button onClick={handleDisableWhiteLabel} disabled={actionLoading === 'wl_disable'} className="px-4 py-2 bg-red-600 text-white rounded text-sm disabled:opacity-50">
                  {actionLoading === 'wl_disable' ? 'Disabling...' : 'Disable White-Label'}
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-3">Flow: Request → Entitlement Check → Provisioning → Active. Never direct DB flag.</p>
          </>
        )}
      </div>

      {/* Feature Access */}
      {featureAccess && (
        <div className="bg-white border rounded-lg p-6">
          <h3 className="font-medium mb-3">Effective Feature Access (Same Enforcement as Runtime)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-sm font-medium mb-2">Features</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(featureAccess.features || []).map((f: any) => (
                  <div key={f.featureKey} className="flex justify-between text-xs border-b py-1">
                    <span>{f.featureKey}</span>
                    <span className={f.enabled ? 'text-green-600' : 'text-red-600'}>{f.enabled ? '✓' : '✗'} {f.source} {f.reason ? `(${f.reason})` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Limits</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(featureAccess.limits || []).map((l: any) => (
                  <div key={l.limitKey} className="flex justify-between text-xs border-b py-1">
                    <span>{l.limitKey}</span>
                    <span>{l.unlimited ? 'Unlimited' : `${l.currentUsage}/${l.configuredLimit}`}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

FILE: apps/admin-web/src/modules/risk/kill-switch-controls.tsx

```tsx
// # Renders platform/tenant/venue/symbol kill-switch toggles with mandatory reason and confirmation
'use client';

import {
  RiskSwitchControls,
  RiskSwitchRowActions,
  type SwitchRow,
} from '@/app/(console)/risk/switch-controls';

export {
  RiskSwitchControls,
  RiskSwitchControls as KillSwitchControls,
  RiskSwitchRowActions,
  type SwitchRow,
};

export type KillSwitchScopeType = 'GLOBAL' | 'EXCHANGE' | 'STRATEGY' | 'SYMBOL';

export interface KillSwitchAuditValidation {
  valid: boolean;
  error?: string;
}

export function validateKillSwitchMutationInput(params: {
  scope: KillSwitchScopeType;
  target?: string;
  reason: string;
}): KillSwitchAuditValidation {
  if (!params.reason || params.reason.trim().length < 10) {
    return {
      valid: false,
      error: 'Kill-switch reason must be at least 10 characters for audit compliance.',
    };
  }
  if (params.scope !== 'GLOBAL' && (!params.target || !params.target.trim())) {
    return {
      valid: false,
      error: `Target identifier is required when scope is ${params.scope}.`,
    };
  }
  return { valid: true };
}
```

FILE: apps/admin-web/src/styles/billing-utilities.css

```css
/*
 * Billing module styles (round 7).
 *
 * The billing portal / SaaS admin components under src/modules/billing were
 * written with utility class names (p-6, bg-white, text-gray-500, ...), but
 * the console has no Tailwind - it styles with the CSS custom properties in
 * globals.css. This sheet defines exactly the utilities those components use,
 * mapped onto the console's own tokens (dark surfaces, tenant-brandable
 * primary colour), and ONLY inside `.wlct-billing`, the wrapper the billing
 * routes render. Nothing here can restyle the rest of the console.
 *
 * Imported by the billing route layouts (app/(console)/billing, /plans,
 * /saas-admin).
 */

.wlct-billing {
  --wb-success-tint: rgba(47, 191, 113, 0.14);
  --wb-warning-tint: rgba(232, 163, 61, 0.14);
  --wb-danger-tint: rgba(229, 72, 77, 0.14);
  --wb-info-tint: rgba(79, 124, 255, 0.14);
  --wb-info-strong: rgba(79, 124, 255, 0.45);
  color: var(--wlct-color-text);
}

/* ---- Form controls and tables (unstyled by the components themselves) ---- */
.wlct-billing input,
.wlct-billing select,
.wlct-billing textarea {
  background: var(--wlct-color-surface-raised);
  color: var(--wlct-color-text);
  border: 1px solid var(--wlct-color-border);
  border-radius: var(--wlct-radius-sm);
  font: inherit;
}
.wlct-billing input:focus,
.wlct-billing select:focus,
.wlct-billing textarea:focus {
  outline: 2px solid var(--wlct-color-primary);
  outline-offset: 1px;
}
.wlct-billing button {
  font: inherit;
  cursor: pointer;
  background: transparent;
  color: inherit;
  border: 0;
}
.wlct-billing table {
  border-collapse: collapse;
}
.wlct-billing th {
  font-weight: 600;
  color: var(--wlct-color-text-muted);
}
.wlct-billing h1,
.wlct-billing h2,
.wlct-billing h3,
.wlct-billing h4,
.wlct-billing p {
  margin: 0;
}

/* ---- Layout ---- */
.wlct-billing .block { display: block; }
.wlct-billing .inline-block { display: inline-block; }
.wlct-billing .inline-flex { display: inline-flex; }
.wlct-billing .flex { display: flex; }
.wlct-billing .grid { display: grid; }
.wlct-billing .flex-1 { flex: 1 1 0%; }
.wlct-billing .flex-wrap { flex-wrap: wrap; }
.wlct-billing .items-center { align-items: center; }
.wlct-billing .justify-between { justify-content: space-between; }
.wlct-billing .justify-center { justify-content: center; }
.wlct-billing .grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
.wlct-billing .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.wlct-billing .grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (min-width: 768px) {
  .wlct-billing .md\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .wlct-billing .md\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .wlct-billing .md\:grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
.wlct-billing .gap-1 { gap: 4px; }
.wlct-billing .gap-2 { gap: 8px; }
.wlct-billing .gap-3 { gap: 12px; }
.wlct-billing .gap-4 { gap: 16px; }
.wlct-billing .gap-6 { gap: 24px; }
.wlct-billing .space-y-1 > * + * { margin-top: 4px; }
.wlct-billing .space-y-2 > * + * { margin-top: 8px; }
.wlct-billing .space-y-3 > * + * { margin-top: 12px; }
.wlct-billing .space-y-4 > * + * { margin-top: 16px; }
.wlct-billing .space-y-6 > * + * { margin-top: 24px; }
.wlct-billing .fixed { position: fixed; }
.wlct-billing .inset-0 { inset: 0; }
.wlct-billing .z-50 { z-index: 50; }
.wlct-billing .overflow-x-auto { overflow-x: auto; }
.wlct-billing .overflow-y-auto { overflow-y: auto; }
.wlct-billing .mx-auto { margin-left: auto; margin-right: auto; }

/* ---- Sizing ---- */
.wlct-billing .w-full { width: 100%; }
.wlct-billing .w-1\/3 { width: 33.333333%; }
.wlct-billing .w-8 { width: 32px; }
.wlct-billing .h-2 { height: 8px; }
.wlct-billing .h-8 { height: 32px; }
.wlct-billing .h-32 { height: 128px; }
.wlct-billing .h-48 { height: 192px; }
.wlct-billing .h-64 { height: 256px; }
.wlct-billing .max-h-48 { max-height: 192px; }
.wlct-billing .max-h-64 { max-height: 256px; }
.wlct-billing .max-w-md { max-width: 448px; }

/* ---- Spacing ---- */
.wlct-billing .p-3 { padding: 12px; }
.wlct-billing .p-4 { padding: 16px; }
.wlct-billing .p-6 { padding: 24px; }
.wlct-billing .px-1\.5 { padding-left: 6px; padding-right: 6px; }
.wlct-billing .px-2 { padding-left: 8px; padding-right: 8px; }
.wlct-billing .px-3 { padding-left: 12px; padding-right: 12px; }
.wlct-billing .px-4 { padding-left: 16px; padding-right: 16px; }
.wlct-billing .py-0\.5 { padding-top: 2px; padding-bottom: 2px; }
.wlct-billing .py-1 { padding-top: 4px; padding-bottom: 4px; }
.wlct-billing .py-1\.5 { padding-top: 6px; padding-bottom: 6px; }
.wlct-billing .py-2 { padding-top: 8px; padding-bottom: 8px; }
.wlct-billing .py-3 { padding-top: 12px; padding-bottom: 12px; }
.wlct-billing .py-12 { padding-top: 48px; padding-bottom: 48px; }
.wlct-billing .pt-3 { padding-top: 12px; }
.wlct-billing .pt-4 { padding-top: 16px; }
.wlct-billing .mb-1 { margin-bottom: 4px; }
.wlct-billing .mb-2 { margin-bottom: 8px; }
.wlct-billing .mb-3 { margin-bottom: 12px; }
.wlct-billing .mb-4 { margin-bottom: 16px; }
.wlct-billing .mt-1 { margin-top: 4px; }
.wlct-billing .mt-2 { margin-top: 8px; }
.wlct-billing .mt-3 { margin-top: 12px; }
.wlct-billing .mt-4 { margin-top: 16px; }
.wlct-billing .mt-6 { margin-top: 24px; }
.wlct-billing .ml-1 { margin-left: 4px; }
.wlct-billing .mr-1 { margin-right: 4px; }

/* ---- Typography ---- */
.wlct-billing .text-xs { font-size: 12px; line-height: 16px; }
.wlct-billing .text-sm { font-size: 14px; line-height: 20px; }
.wlct-billing .text-lg { font-size: 18px; line-height: 28px; }
.wlct-billing .text-xl { font-size: 20px; line-height: 28px; }
.wlct-billing .text-2xl { font-size: 24px; line-height: 32px; }
.wlct-billing .text-3xl { font-size: 30px; line-height: 36px; }
.wlct-billing .font-medium { font-weight: 500; }
.wlct-billing .font-semibold { font-weight: 600; }
.wlct-billing .font-bold { font-weight: 700; }
.wlct-billing .font-mono { font-family: var(--wlct-font-mono); }
.wlct-billing .text-left { text-align: left; }
.wlct-billing .text-center { text-align: center; }
.wlct-billing .hover\:underline:hover { text-decoration: underline; }

/* ---- Borders and radius ---- */
.wlct-billing .border { border: 1px solid var(--wlct-color-border); }
.wlct-billing .border-4 { border-width: 4px; border-style: solid; }
.wlct-billing .border-b { border-bottom: 1px solid var(--wlct-color-border); }
.wlct-billing .border-t { border-top: 1px solid var(--wlct-color-border); }
.wlct-billing .border-gray-200,
.wlct-billing .border-gray-300 { border-color: var(--wlct-color-border); }
.wlct-billing .border-blue-200 { border-color: var(--wb-info-strong); }
.wlct-billing .border-blue-500,
.wlct-billing .border-blue-600 { border-color: var(--wlct-color-primary); }
.wlct-billing .border-red-200 { border-color: var(--wlct-color-danger); }
.wlct-billing .border-yellow-200 { border-color: var(--wlct-color-warning); }
.wlct-billing .border-t-transparent { border-top-color: transparent; }
.wlct-billing .rounded { border-radius: var(--wlct-radius-sm); }
.wlct-billing .rounded-lg { border-radius: var(--wlct-radius-md); }
.wlct-billing .rounded-full { border-radius: 9999px; }
.wlct-billing .ring-2 { box-shadow: 0 0 0 2px var(--wb-info-strong); }
.wlct-billing .ring-blue-200 { --wb-ring: var(--wb-info-strong); }

/* ---- Surfaces ---- */
.wlct-billing .bg-white { background: var(--wlct-color-surface); }
.wlct-billing .bg-gray-50 { background: var(--wlct-color-surface-raised); }
.wlct-billing .bg-gray-100 { background: var(--wlct-color-surface-raised); }
.wlct-billing .bg-gray-200 { background: var(--wlct-color-border); }
.wlct-billing .bg-gray-600 { background: #4b5563; }
.wlct-billing .bg-gray-800 { background: var(--wlct-color-surface-raised); border: 1px solid var(--wlct-color-border); }
.wlct-billing .bg-black\/50 { background: rgba(0, 0, 0, 0.5); }
.wlct-billing .bg-blue-50,
.wlct-billing .bg-blue-100 { background: var(--wb-info-tint); }
.wlct-billing .bg-blue-600 { background: var(--wlct-color-primary); color: var(--wlct-color-primary-contrast); }
.wlct-billing .bg-green-100 { background: var(--wb-success-tint); }
.wlct-billing .bg-green-600 { background: var(--wlct-color-success); color: #ffffff; }
.wlct-billing .bg-red-50,
.wlct-billing .bg-red-100 { background: var(--wb-danger-tint); }
.wlct-billing .bg-red-600 { background: var(--wlct-color-danger); color: #ffffff; }
.wlct-billing .bg-yellow-50,
.wlct-billing .bg-yellow-100 { background: var(--wb-warning-tint); }
.wlct-billing .hover\:bg-gray-50:hover { background: var(--wlct-color-surface-raised); }
.wlct-billing .hover\:bg-gray-900:hover { background: var(--wlct-color-border); }
.wlct-billing .hover\:bg-blue-700:hover { filter: brightness(0.9); }
.wlct-billing .hover\:bg-green-700:hover { filter: brightness(0.9); }
.wlct-billing .hover\:bg-red-700:hover { filter: brightness(0.9); }

/* ---- Text colours ---- */
.wlct-billing .text-white { color: #ffffff; }
.wlct-billing .text-gray-300,
.wlct-billing .text-gray-400,
.wlct-billing .text-gray-500,
.wlct-billing .text-gray-600 { color: var(--wlct-color-text-muted); }
.wlct-billing .text-gray-700,
.wlct-billing .text-gray-800 { color: var(--wlct-color-text); }
.wlct-billing .hover\:text-gray-900:hover { color: var(--wlct-color-text); }
.wlct-billing .text-blue-600,
.wlct-billing .text-blue-700,
.wlct-billing .text-blue-800 { color: var(--wlct-color-primary); }
.wlct-billing .text-green-500,
.wlct-billing .text-green-600,
.wlct-billing .text-green-800 { color: var(--wlct-color-success); }
.wlct-billing .text-red-600,
.wlct-billing .text-red-700,
.wlct-billing .text-red-800 { color: var(--wlct-color-danger); }
.wlct-billing .text-yellow-600,
.wlct-billing .text-yellow-700,
.wlct-billing .text-yellow-800,
.wlct-billing .text-orange-600 { color: var(--wlct-color-warning); }

/* ---- States ---- */
.wlct-billing .cursor-not-allowed { cursor: not-allowed; }
.wlct-billing .disabled\:opacity-50:disabled { opacity: 0.5; cursor: not-allowed; }
.wlct-billing .animate-pulse { animation: wlct-billing-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
.wlct-billing .animate-spin { animation: wlct-billing-spin 1s linear infinite; }

@keyframes wlct-billing-pulse {
  50% { opacity: 0.5; }
}
@keyframes wlct-billing-spin {
  to { transform: rotate(360deg); }
}

/* Bordered utility buttons (`border rounded px-3 py-2`) read as secondary actions. */
.wlct-billing button.border:hover { background: var(--wlct-color-surface-raised); }
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

FILE: apps/admin-web/src/tests/api-error.test.ts

```typescript
// # Verifies admin-web consumes the same shared ApiError implementation as customer web
import { ApiError } from '@wlct/utils/api-error';

describe('shared ApiError in admin-web', () => {
  it('preserves the API code, request id, and form field details', () => {
    const error = ApiError.fromBody(400, {
      error: {
        code: 'INVALID_INPUT',
        message: 'The request is invalid.',
        details: [{ field: 'tenantId', message: 'Required.' }],
        requestId: 'admin-request-456',
      },
    });

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.requestId).toBe('admin-request-456');
    expect(error.fieldErrors).toEqual({ tenantId: 'Required.' });
  });
});
```

FILE: apps/admin-web/src/tests/compliance-audit-timeline.test.tsx

```tsx
// # NEW — Verifies compliance audit timeline rendering
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComplianceAuditTimeline } from '../features/compliance/compliance-audit-timeline';

describe('ComplianceAuditTimeline (GAP-34)', () => {
  test('renders chronological compliance audit events with actor and rationale', () => {
    const html = renderToStaticMarkup(
      <ComplianceAuditTimeline
        events={[
          {
            id: 'ev-2',
            eventType: 'CASE_DECISION_RECORDED',
            actorId: 'mlro-1',
            decision: 'HOLD',
            rationale: 'Account withdrawals placed on hold pending secondary OFAC verification',
            createdAt: '2026-10-01T11:00:00.000Z',
          },
          {
            id: 'ev-1',
            eventType: 'CASE_OPENED',
            actorId: 'SYSTEM',
            decision: null,
            rationale: 'Auto-opened by transaction monitoring rule STRUCTURING_24H',
            createdAt: '2026-10-01T10:00:00.000Z',
          },
        ]}
      />,
    );

    expect(html).toContain('data-testid="compliance-audit-timeline"');
    expect(html).toContain('CASE_OPENED');
    expect(html).toContain('CASE_DECISION_RECORDED');
    expect(html).toContain('Account withdrawals placed on hold pending secondary OFAC verification');
    // Chronological order: ev-1 appears before ev-2
    expect(html.indexOf('ev-1')).toBeLessThan(html.indexOf('ev-2'));
  });
});
```

FILE: apps/admin-web/src/tests/compliance-case-queue.test.tsx

```tsx
// # NEW — Verifies compliance case queue rendering and status filtering
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ComplianceCaseQueue,
  type ComplianceCaseQueueItem,
} from '../features/compliance/compliance-case-queue';

const SAMPLE_CASES: ComplianceCaseQueueItem[] = [
  {
    id: 'case-open-101',
    tenantId: 'tenant-1',
    userId: 'user-alpha',
    caseType: 'AML_SANCTIONS_HIT',
    state: 'ESCALATED',
    riskLevel: 'CRITICAL',
    severity: 'CRITICAL',
    safeSummary: 'Potential OFAC watchlist match on withdrawal address',
    assignedTo: 'mlro-1',
    jurisdiction: 'US',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:05:00.000Z',
  },
  {
    id: 'case-resolved-202',
    tenantId: 'tenant-1',
    userId: 'user-beta',
    caseType: 'VELOCITY_ALERT',
    state: 'RESOLVED',
    riskLevel: 'LOW',
    severity: 'LOW',
    safeSummary: 'Cleared rapid deposit velocity after source-of-funds review',
    assignedTo: 'reviewer-2',
    jurisdiction: 'SG',
    createdAt: '2026-09-29T08:00:00.000Z',
    updatedAt: '2026-09-30T12:00:00.000Z',
  },
];

describe('ComplianceCaseQueue (GAP-31)', () => {
  test('renders all compliance cases with severity, state, and subject user', () => {
    const html = renderToStaticMarkup(<ComplianceCaseQueue cases={SAMPLE_CASES} />);
    expect(html).toContain('data-testid="compliance-case-queue"');
    expect(html).toContain('Potential OFAC watchlist match on withdrawal address');
    expect(html).toContain('Cleared rapid deposit velocity after source-of-funds review');
    expect(html).toContain('Showing 2 of 2 cases');
  });

  test('filters compliance cases by initialStateFilter and initialSeverityFilter', () => {
    const html = renderToStaticMarkup(
      <ComplianceCaseQueue
        cases={SAMPLE_CASES}
        initialStateFilter="ESCALATED"
        initialSeverityFilter="CRITICAL"
      />,
    );
    expect(html).toContain('Potential OFAC watchlist match on withdrawal address');
    expect(html).not.toContain('Cleared rapid deposit velocity after source-of-funds review');
    expect(html).toContain('Showing 1 of 2 cases');
  });
});
```

FILE: apps/admin-web/src/tests/compliance-queue-envelope.test.tsx

```tsx
// # Responsibility: pins the admin compliance page to the envelope the API actually answers with, so the queue cannot silently render empty again while the console reports success.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));

jest.mock('../lib/server-api', () => ({
  serverFetch: jest.fn(),
}));

import { serverFetch } from '../lib/server-api';
import ComplianceQueuePage from '../app/(console)/compliance/page';

const serverFetchMock = serverFetch as unknown as jest.Mock;

/**
 * Why this test exists.
 *
 * `GET /v1/compliance/cases` answers with the platform's paged envelope - `{ data, total, page,
 * limit }` from `complianceCase.repository.listTenantCases` - and `GET
 * /v1/compliance/monitoring/signals` answers `{ data, total }`. The page asked for `items` and
 * `cases` instead, so against the real API the compliance queue rendered its empty state and the
 * console reported success: a compliance screen that shows no cases looks exactly like a tenant
 * with no cases. Nothing failed, nothing was logged, and no test existed.
 *
 * These tests are deliberately written against the *envelope*, not the rendered strings alone: the
 * first one fails if the page reads `items` (it would render zero rows and the case id would be
 * absent), and the second fails if a future edit reintroduces a shape the API does not send.
 */
describe('admin compliance queue page', () => {
  const endpointPayloads = () => ({
    cases: {
      data: [
        {
          id: 'case-envelope-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          caseType: 'KYC_REVIEW',
          state: 'OPEN',
          severity: 'HIGH',
          riskLevel: 'HIGH',
          decision: null,
          assignedTo: null,
          assignedAt: null,
          escalatedAt: null,
          resolvedAt: null,
          closedAt: null,
          idempotencyKey: 'case-envelope-1-key',
          safeSummary: 'Identity document requires manual review.',
          jurisdiction: 'BD',
          policyVersion: 'v1',
          ruleIds: [],
          sourceRefs: [],
          metadata: {},
          createdAt: '2026-10-01T09:00:00.000Z',
          updatedAt: '2026-10-06T09:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    },
    signals: { data: [{ id: 'signal-1' }], total: 1 },
  });

  beforeEach(() => {
    serverFetchMock.mockReset();
    const payloads = endpointPayloads();
    serverFetchMock.mockImplementation(async (path: string) => {
      if (path === '/compliance/cases') return payloads.cases;
      if (path === '/compliance/monitoring/signals') return payloads.signals;
      throw new Error(`unexpected path ${path}`);
    });
  });

  it('renders a case delivered in the API paged envelope', async () => {
    const html = renderToStaticMarkup(await ComplianceQueuePage());

    expect(html).toContain('Identity document requires manual review.');
    expect(html).toContain('case-envelo');
    expect(html).toContain('compliance-case-queue');
    // One case in the queue, so the "Showing 1 of 1" counter line must not be the empty state.
    expect(html).not.toContain('No compliance cases match filter');
  });

  it('asks for the two endpoints with the query limits the API accepts', async () => {
    await ComplianceQueuePage();

    expect(serverFetchMock).toHaveBeenCalledWith('/compliance/cases', {
      searchParams: { limit: 50 },
    });
    expect(serverFetchMock).toHaveBeenCalledWith('/compliance/monitoring/signals', {
      searchParams: { limit: 25 },
    });
  });

  it('shows the failure notice and no rows when an endpoint fails, rather than inventing cases', async () => {
    serverFetchMock.mockImplementation(async (path: string) => {
      if (path === '/compliance/cases') throw new Error('compliance API unreachable');
      return { data: [], total: 0 };
    });

    const html = renderToStaticMarkup(await ComplianceQueuePage());

    expect(html).toContain('Compliance data partially degraded');
    expect(html).toContain('compliance API unreachable');
    expect(html).toContain('No compliance cases match filter');
  });

  it('does not read an `items` field the API never sends', async () => {
    // The guard against the exact regression: give the page a payload that has `items` populated
    // and `data` empty, and require that nothing is rendered from `items`.
    serverFetchMock.mockImplementation(async (path: string) => {
      if (path === '/compliance/cases') {
        return {
          data: [],
          total: 0,
          page: 1,
          limit: 50,
          // A field from a different API version, or from the shape this page used to guess.
          items: endpointPayloads().cases.data,
        } as unknown;
      }
      return { data: [], total: 0 };
    });

    const html = renderToStaticMarkup(await ComplianceQueuePage());

    expect(html).not.toContain('Identity document requires manual review.');
    expect(html).toContain('No compliance cases match filter');
  });
});
```

FILE: apps/admin-web/src/tests/exchange-rate-limit-health.test.tsx

```tsx
// # Responsibility: protects the operator budget panel from rendering an unreadable rate-limit state as a healthy one.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ExchangeRateLimitHealth,
  pressureTone,
  summarizeRateLimitHealth,
  toRateLimitRow,
  type ExchangeRateLimitRow,
  type ServerRateLimitState,
} from '../features/execution/exchange-rate-limit-health';

const measuredState: ServerRateLimitState = {
  venue: 'BINANCE',
  environment: 'LIVE',
  accountId: 'account-a',
  endpointClass: 'ORDER',
  currentUsage: 300,
  remaining: 300,
  pressure: 50,
  isWeightBased: true,
  requestsPerInterval: 10,
  scope: 'ACCOUNT',
  retryAfterMs: null,
  resetAtMs: 1767000000000,
};

function row(overrides: Partial<ExchangeRateLimitRow>): ExchangeRateLimitRow {
  return { ...toRateLimitRow('account-a', measuredState, { venue: 'BINANCE', endpointClass: 'ORDER' }), ...overrides };
}

describe('exchange rate-limit health', () => {
  test('a readable budget is shown with its measured usage, headroom and pressure', () => {
    const html = renderToStaticMarkup(<ExchangeRateLimitHealth rows={[row({})]} />);
    expect(html).toContain('300');
    expect(html).toContain('50%');
    expect(html).toContain('BINANCE');
    expect(html).toContain('ORDER');
    expect(html).not.toContain('UNKNOWN');
    expect(html).not.toContain('BUDGET UNKNOWN');
  });

  // The failure this panel exists to prevent: an unreadable budget rendered as an empty, healthy bar.
  test('an unreadable budget is UNKNOWN with its reason, never a healthy reading', () => {
    const unavailable = toRateLimitRow('account-a', null, { venue: 'BINANCE', endpointClass: 'ORDER' });
    const html = renderToStaticMarkup(<ExchangeRateLimitHealth rows={[unavailable]} />);

    expect(html).toContain('UNKNOWN');
    expect(html).toContain('BUDGET UNKNOWN');
    expect(html).toContain('could not be read');
    // No invented numbers: no zero pressure, no zero remaining.
    expect(html).not.toContain('>0%<');
    expect(unavailable.pressure).toBeNull();
    expect(unavailable.remaining).toBeNull();
    expect(unavailable.currentUsage).toBeNull();
  });

  test('the summary counts unreadable budgets separately from busy ones and withholds the worst pressure', () => {
    const summary = summarizeRateLimitHealth([
      row({ pressure: 95 }),
      row({ pressure: 75 }),
      toRateLimitRow('account-b', null, { venue: 'OKX', endpointClass: 'PRIVATE' }),
    ]);

    expect(summary).toEqual({ total: 3, unavailable: 1, atOrAboveWarning: 2, worstPressure: 95 });

    // With every budget unreadable there is no worst pressure to report - null, not 0.
    const allUnknown = summarizeRateLimitHealth([
      toRateLimitRow('account-a', null, { venue: 'BINANCE', endpointClass: 'ORDER' }),
    ]);
    expect(allUnknown.worstPressure).toBeNull();
    expect(allUnknown.unavailable).toBe(1);
  });

  test('pressure tones band at the documented thresholds and an unknown pressure has no tone', () => {
    expect(pressureTone(null)).toBeNull();
    expect(pressureTone(69)).toBe('neutral');
    expect(pressureTone(70)).toBe('warning');
    expect(pressureTone(89)).toBe('warning');
    expect(pressureTone(90)).toBe('danger');
    expect(pressureTone(100)).toBe('danger');
  });

  test('an account with no reported state stays in the list as unavailable rather than disappearing', () => {
    const rows = [
      row({}),
      toRateLimitRow('account-c', null, { venue: 'KRAKEN', endpointClass: 'PUBLIC' }),
    ];
    const html = renderToStaticMarkup(<ExchangeRateLimitHealth rows={rows} />);

    expect(html).toContain('account-c');
    expect(html).toContain('KRAKEN');
    expect(html).toContain('2 accounts monitored');
  });
});
```

FILE: apps/admin-web/src/tests/execution-incidents-page.test.tsx

```tsx
// # NEW — Verifies admin execution incident console and kill-switch actions
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExecutionIncidentTable } from '../features/execution/execution-incident-table';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));

describe('ExecutionIncidentTable (GAP-26)', () => {
  test('renders execution incidents, severity badges, and kill-switch controls', () => {
    const html = renderToStaticMarkup(
      <ExecutionIncidentTable
        incidents={[
          {
            id: 'inc-101',
            accountId: 'acct-1',
            orderId: 'ord-1',
            clientOrderId: 'oms12345',
            incidentType: 'UNKNOWN_ORDER_RESULT',
            severity: 'CRITICAL',
            venue: 'BINANCE',
            symbol: 'BTC-USDT',
            errorCode: 'TIMEOUT',
            summary: 'Order submit timed out waiting for venue acknowledgement',
            details: {},
            occurredAtMicros: '1700000000000000',
            resolvedAt: null,
            resolvedBy: null,
            resolutionNote: null,
            createdAt: '2026-10-01T10:00:00.000Z',
          },
        ]}
        killSwitches={[
          {
            id: 'ks-1',
            scope: 'EXCHANGE',
            target: 'BINANCE',
            isEngaged: true,
            reason: 'Elevated timeout rate on Binance spot',
            engagedAt: '2026-10-01T10:01:00.000Z',
            releasedAt: null,
          },
        ]}
      />,
    );

    expect(html).toContain('data-testid="execution-incident-console"');
    expect(html).toContain('data-testid="execution-kill-switch-form"');
    expect(html).toContain('UNKNOWN_ORDER_RESULT');
    expect(html).toContain('Order submit timed out waiting for venue acknowledgement');
    expect(html).toContain('EXCHANGE:BINANCE');
  });
});
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

