'use client';

import { PageContainer } from '@/layout/page-container';
import { useDashboardData } from './dashboard-query';
import {
  PortfolioWidget,
  TradingStatusWidget,
  CopySubscriptionsWidget,
  ExchangeHealthWidget,
  FundingWidget,
  BillingWidget,
  SecurityWidget,
} from './dashboard-widgets';
import { useAuth } from '@/auth/auth.store';
import { MaintenanceBanner } from '@/components/maintenance-banner';

export function DashboardPage(): JSX.Element {
  const { session } = useAuth();
  const { portfolio, tradingStatus, subscriptions, exchanges, funding, subscription, usage, notifications } = useDashboardData();

  return (
    <PageContainer
      title={`Welcome, ${session?.user.displayName ?? session?.user.email ?? 'User'}`}
      description="Your trading overview with real-time backend data"
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <PortfolioWidget data={portfolio.data} isLoading={portfolio.isLoading} error={portfolio.error} />
        <TradingStatusWidget data={tradingStatus.data} isLoading={tradingStatus.isLoading} />
        <CopySubscriptionsWidget data={subscriptions.data} isLoading={subscriptions.isLoading} />
        <ExchangeHealthWidget data={exchanges.data} isLoading={exchanges.isLoading} />
        <FundingWidget data={funding.data} isLoading={funding.isLoading} />
        <BillingWidget subscription={subscription.data} usage={usage.data} isLoading={subscription.isLoading} />
        <SecurityWidget mfaEnabled={session?.user.mfaEnabled} />
      </div>

      <div className="mt-6 rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold">Operational Status</h3>
        <p className="mt-1 text-xs text-muted">Maintenance and degradation states are displayed from backend Operations API.</p>
        <MaintenanceBanner />
        {tradingStatus.data?.maintenance?.active && (
          <div className="mt-2 rounded bg-yellow-50 p-2 text-xs text-yellow-800">{tradingStatus.data.maintenance.message}</div>
        )}
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold">Recent Notifications</h3>
        {notifications.data ? (
          <ul className="mt-2 space-y-1">
            {notifications.data.data.slice(0, 5).map((n) => (
              <li key={n.id} className="rounded border p-2 text-xs">
                <span className="font-medium">{n.title}</span> — {n.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted">No recent notifications</p>
        )}
      </div>
    </PageContainer>
  );
}
