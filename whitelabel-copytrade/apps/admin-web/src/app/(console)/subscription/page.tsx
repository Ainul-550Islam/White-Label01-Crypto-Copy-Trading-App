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
