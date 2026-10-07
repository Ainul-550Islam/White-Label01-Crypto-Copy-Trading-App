'use client';

import Link from 'next/link';
import { useAuth } from '@/auth/auth.store';
import { useTenant } from '@/tenant/tenant-context';
import { PageContainer } from '@/layout/page-container';
import { PlanComparison } from '@/features/billing/plan-comparison';

const ENTITLEMENT_CATEGORIES = [
  {
    title: 'Copy Trading & Strategy Subscriptions',
    detail:
      'Follower subscriptions, leader-fill ingestion, proportional/fixed/percentage sizing, and missing-copy reconciliation governed by your organisation plan.',
  },
  {
    title: 'Exchange Connectivity & Secret Management',
    detail:
      'Trade-only exchange account limits across Binance, Bybit, OKX, Kraken, and Coinbase with AES-256-GCM envelope encryption or Vault / AWS Secrets Manager storage.',
  },
  {
    title: 'Portfolio Accounting & Verifiable Statements',
    detail:
      'Real-time NAV, realized/unrealized PnL, strategy attribution, and finalized period statement exports in CSV and JSON.',
  },
  {
    title: 'Enterprise Security, SSO & Custom Domains',
    detail:
      'TOTP MFA, device trust, scoped API keys, OIDC/SAML Single Sign-On with Single Logout, and verified custom domain branding.',
  },
];

/**
 * The live plan catalogue is served by the authenticated billing portal
 * (/v1/billing/portal/plans, subscription:read). Signed-in customers see the
 * live backend plan comparison directly; unauthenticated visitors see the
 * entitlement & metering model with sign-in / registration actions (never
 * hardcoded prices or plan limits).
 */
export default function PricingPage(): JSX.Element {
  const { session } = useAuth();
  const { tenant } = useTenant();
  const brandName = tenant?.branding?.appName ?? tenant?.name ?? 'Copy Trading Platform';

  return (
    <PageContainer
      title={`${brandName} Plans & Entitlements`}
      description="Backend-authoritative subscription plans, feature entitlements, and usage meters"
      actions={
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href="/" className="rounded border px-3 py-1.5 hover:bg-accent">
            Home
          </Link>
          {session ? (
            <Link href="/billing" className="rounded bg-primary px-3 py-1.5 text-white">
              Billing Portal
            </Link>
          ) : (
            <>
              <Link href="/login" className="rounded border px-3 py-1.5 hover:bg-accent">
                Sign In
              </Link>
              <Link href="/register" className="rounded bg-primary px-3 py-1.5 text-white">
                Create Account
              </Link>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {session ? (
          <div className="space-y-4">
            <div className="rounded border bg-card p-4 text-xs text-muted">
              Showing live plan catalogue and upgrade/downgrade eligibility for organisation{' '}
              <strong className="text-foreground">{session.tenant.name}</strong>. All prices, trial periods, and
              entitlement limits come directly from the billing portal API.
            </div>
            <PlanComparison />
          </div>
        ) : (
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <h2 className="text-base font-semibold">Organisation-Scoped Pricing Catalogue</h2>
            <p className="text-sm text-muted leading-relaxed">
              Plan pricing, billing intervals, trial windows, currency, and usage quotas are configured per
              organisation on the backend and are never hardcoded in the browser. Sign in or create an account to
              inspect the live plans published for your organisation and start a checkout session.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <Link
                href="/login"
                className="rounded bg-primary px-4 py-2 text-sm font-medium text-white"
              >
                Sign In to View Live Plans
              </Link>
              <Link
                href="/register"
                className="rounded border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Register New Account
              </Link>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <h2 className="text-base font-semibold">What Plans Govern</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {ENTITLEMENT_CATEGORIES.map((item) => (
              <div key={item.title} className="rounded border bg-card p-4">
                <h3 className="text-sm font-semibold">{item.title}</h3>
                <p className="mt-1 text-xs text-muted leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
