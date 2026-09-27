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
