'use client';

import { Money, MoneyWithState } from '@/components/money';
import { Percentage } from '@/components/percentage';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { EmptyState } from '@/components/empty-state';
import Link from 'next/link';

interface WidgetProps {
  title: string;
  children: React.ReactNode;
  action?: { label: string; href: string };
  className?: string;
}

function Widget({ title, children, action, className }: WidgetProps): JSX.Element {
  return (
    <div className={`rounded-lg border bg-card p-4 ${className ?? ''}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action && (
          <Link href={action.href} className="text-xs text-primary hover:underline">
            {action.label}
          </Link>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function PortfolioWidget({ data, isLoading, error }: { data?: { nav: string; dailyPnl: string; currency: string; valuationState: string }; isLoading: boolean; error: unknown }): JSX.Element {
  if (isLoading) return <Widget title="Portfolio"><LoadingState message="Loading portfolio..." /></Widget>;
  if (error) return <Widget title="Portfolio"><ErrorState error={error} /></Widget>;
  if (!data) return <Widget title="Portfolio"><EmptyState title="No portfolio data" description="Portfolio data is unavailable" /></Widget>;

  return (
    <Widget title="Portfolio" action={{ label: 'View', href: '/portfolio' }}>
      <div className="space-y-2">
        <div>
          <p className="text-xs text-muted">NAV</p>
          <MoneyWithState value={data.nav} currency={data.currency} valuationState={data.valuationState} />
        </div>
        <div>
          <p className="text-xs text-muted">Daily PnL</p>
          <Money value={data.dailyPnl} currency={data.currency} showSign />
        </div>
        {data.valuationState !== 'VALID' && (
          <p className="text-xs text-yellow-600">Valuation: {data.valuationState}</p>
        )}
      </div>
    </Widget>
  );
}

export function TradingStatusWidget({ data, isLoading }: { data?: { eligibility: string; isLive: boolean; restrictions: Array<{ type: string; reason: string }> }; isLoading: boolean }): JSX.Element {
  if (isLoading) return <Widget title="Trading Status"><LoadingState /></Widget>;
  if (!data) return <Widget title="Trading Status"><EmptyState title="No trading status" /></Widget>;

  return (
    <Widget title="Trading Status">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={data.eligibility} />
          {data.isLive ? <StatusBadge status="LIVE" variant="success" /> : <StatusBadge status="PAPER" />}
        </div>
        {data.restrictions.length > 0 && (
          <ul className="space-y-1">
            {data.restrictions.map((r, i) => (
              <li key={i} className="text-xs">
                <StatusBadge status={r.type} /> <span className="text-muted">{r.reason}</span>
              </li>
            ))}
          </ul>
        )}
        {data.restrictions.length === 0 && <p className="text-xs text-muted">No restrictions</p>}
      </div>
    </Widget>
  );
}

export function CopySubscriptionsWidget({ data, isLoading }: { data?: { data: Array<{ id: string; strategyId: string; status: string; allocationAmount: string }> }; isLoading: boolean }): JSX.Element {
  if (isLoading) return <Widget title="Copy Subscriptions"><LoadingState /></Widget>;

  const subs = data?.data ?? [];

  return (
    <Widget title="Copy Subscriptions" action={{ label: 'Manage', href: '/copy-trading' }}>
      {subs.length === 0 ? (
        <EmptyState title="No subscriptions" description="You are not copying any strategies yet" action={{ label: 'Browse Strategies', href: '/strategies' }} />
      ) : (
        <ul className="space-y-2">
          {subs.slice(0, 3).map((s) => (
            <li key={s.id} className="flex items-center justify-between text-sm">
              <span className="truncate">{s.strategyId.slice(0, 8)}</span>
              <div className="flex items-center gap-2">
                <Money value={s.allocationAmount} />
                <StatusBadge status={s.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

export function ExchangeHealthWidget({ data, isLoading }: { data?: { data: Array<{ id: string; exchange: string; health: string; status: string }> }; isLoading: boolean }): JSX.Element {
  if (isLoading) return <Widget title="Exchanges"><LoadingState /></Widget>;

  const accounts = data?.data ?? [];

  return (
    <Widget title="Exchanges" action={{ label: 'Manage', href: '/exchanges' }}>
      {accounts.length === 0 ? (
        <EmptyState title="No exchange accounts" description="Connect an exchange to start trading" action={{ label: 'Connect', href: '/exchanges/connect' }} />
      ) : (
        <ul className="space-y-2">
          {accounts.slice(0, 3).map((a) => (
            <li key={a.id} className="flex items-center justify-between text-sm">
              <span>{a.exchange}</span>
              <div className="flex gap-1">
                <StatusBadge status={a.health} />
                <StatusBadge status={a.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

export function FundingWidget({ data, isLoading }: { data?: { data: Array<{ id: string; type: string; amount: string; state: string }> }; isLoading: boolean }): JSX.Element {
  if (isLoading) return <Widget title="Recent Funding"><LoadingState /></Widget>;

  const items = data?.data ?? [];

  return (
    <Widget title="Recent Funding" action={{ label: 'View All', href: '/funding/history' }}>
      {items.length === 0 ? (
        <EmptyState title="No funding activity" description="Your funding history will appear here" />
      ) : (
        <ul className="space-y-2">
          {items.map((f) => (
            <li key={f.id} className="flex items-center justify-between text-sm">
              <span>{f.type}</span>
              <div className="flex items-center gap-2">
                <Money value={f.amount} />
                <StatusBadge status={f.state} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

export function BillingWidget({ subscription, usage, isLoading }: { subscription?: { planName: string; status: string; currentPeriodEnd: string }; usage?: Array<{ meter: string; current: number; limit: number }>; isLoading: boolean }): JSX.Element {
  if (isLoading) return <Widget title="Billing"><LoadingState /></Widget>;

  return (
    <Widget title="Billing" action={{ label: 'Manage', href: '/billing' }}>
      {subscription ? (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="font-medium">{subscription.planName}</span> <StatusBadge status={subscription.status} />
          </p>
          <p className="text-xs text-muted">Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</p>
          {usage && usage.length > 0 && (
            <div className="mt-2 space-y-1">
              {usage.slice(0, 2).map((u) => (
                <div key={u.meter} className="text-xs">
                  {u.meter}: {u.current}/{u.limit}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <EmptyState title="No subscription" description="Choose a plan to get started" action={{ label: 'View Plans', href: '/billing/plans' }} />
      )}
    </Widget>
  );
}

export function SecurityWidget({ mfaEnabled }: { mfaEnabled?: boolean }): JSX.Element {
  return (
    <Widget title="Security" action={{ label: 'Manage', href: '/security' }}>
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span>MFA</span>
          <StatusBadge status={mfaEnabled ? 'ENABLED' : 'DISABLED'} variant={mfaEnabled ? 'success' : 'warning'} />
        </div>
        <p className="text-xs text-muted">Keep your account secure with two-factor authentication.</p>
      </div>
    </Widget>
  );
}
