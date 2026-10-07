'use client';

import Link from 'next/link';
import { PageContainer } from '@/layout/page-container';
import { useTenant } from '@/tenant/tenant-context';

export default function TermsPage(): JSX.Element {
  const { tenant } = useTenant();
  const brandName = tenant?.branding?.appName ?? tenant?.name ?? 'Copy Trading Platform';
  const supportEmail = tenant?.branding?.supportEmail;
  const externalTermsUrl = tenant?.branding?.termsUrl;

  return (
    <PageContainer
      title="Terms of Service & Copy-Trading Risk Disclosure"
      description={`Governing terms, non-custodial execution rules, and risk disclosures for ${brandName}`}
      actions={
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href="/" className="rounded border px-3 py-1.5 hover:bg-accent">
            Home
          </Link>
          <Link href="/privacy" className="rounded border px-3 py-1.5 hover:bg-accent">
            Privacy Policy
          </Link>
          <Link href="/login" className="rounded bg-primary px-3 py-1.5 text-white">
            Sign In
          </Link>
        </div>
      }
    >
      <div className="space-y-6 text-sm leading-relaxed">
        {externalTermsUrl && (
          <div className="rounded border bg-gray-50 p-4 text-xs">
            <span className="font-medium">Organisation terms addendum: </span>
            <a
              href={externalTermsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              {externalTermsUrl}
            </a>
          </div>
        )}

        <section className="rounded border bg-card p-5 space-y-2">
          <h2 className="text-base font-semibold">1. Non-Custodial Software Service</h2>
          <p className="text-muted">
            {brandName} is a non-custodial software-as-a-service (SaaS) copy-trading and portfolio accounting
            platform. The platform does not take custody of your digital assets unless an explicit, licensed custody
            adapter is enabled by your organisation. You retain direct ownership of your exchange accounts at all
            times, and orders are routed strictly through trade-only API credentials that you authorize.
          </p>
        </section>

        <section className="rounded border bg-card p-5 space-y-2">
          <h2 className="text-base font-semibold">2. Copy-Trading Risk Disclosure &amp; No Investment Advice</h2>
          <p className="text-muted">
            Digital asset trading and automated copy trading involve substantial risk of loss and are not suitable
            for every participant. By subscribing to a trader or strategy on {brandName}, you expressly acknowledge:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-muted">
            <li>
              <strong className="text-foreground">No Financial or Investment Advice:</strong> Trader profiles,
              strategy descriptions, rankings, and historical attribution metrics are provided for informational
              purposes only and never constitute personalized investment, legal, or tax advice.
            </li>
            <li>
              <strong className="text-foreground">Execution &amp; Market Variance:</strong> Follower fills may differ
              from leader fills due to market liquidity, exchange rate limits, minimum notional rules, symbol
              availability, latency, or pre-trade risk rejections.
            </li>
            <li>
              <strong className="text-foreground">Verifiable Performance Only:</strong> The platform never fabricates
              or simulates trading returns. Where a valuation price or FX rate is stale or unavailable, the
              portfolio and statement views explicitly report <code className="font-mono text-xs">STALE</code>,{' '}
              <code className="font-mono text-xs">MISSING_PRICE</code>, or{' '}
              <code className="font-mono text-xs">MISSING_FX</code> rather than an estimated figure.
            </li>
          </ul>
        </section>

        <section className="rounded border bg-card p-5 space-y-2">
          <h2 className="text-base font-semibold">3. Exchange API Credential Obligations</h2>
          <ul className="list-disc pl-5 space-y-1 text-muted">
            <li>
              You must configure your exchange API keys with <strong className="text-foreground">trade-only</strong>{' '}
              and <strong className="text-foreground">read</strong> permissions. Keys with withdrawal or transfer
              permissions are strictly prohibited.
            </li>
            <li>
              Where supported by your venue (Binance, Bybit, OKX, Kraken, Coinbase), you should bind your API key to
              the platform&apos;s designated egress IP allowlist.
            </li>
            <li>
              You may disable, rotate, or revoke your exchange connection at any time from the{' '}
              <Link href="/exchanges" className="text-primary underline">
                Exchange Accounts
              </Link>{' '}
              console.
            </li>
          </ul>
        </section>

        <section className="rounded border bg-card p-5 space-y-2">
          <h2 className="text-base font-semibold">4. Pre-Trade Risk Controls, Kill Switches &amp; Maintenance</h2>
          <p className="text-muted">
            Every copy-trading order intent is evaluated by the backend risk engine against day-start-equity daily
            loss limits, intraday drawdown thresholds, maximum position sizing, and venue capability checks. The
            platform or your organisation&apos;s risk administrators may activate global, tenant, strategy, symbol,
            or follower kill switches or scheduled/emergency maintenance windows that pause order routing to protect
            customer accounts.
          </p>
        </section>

        <section className="rounded border bg-card p-5 space-y-2">
          <h2 className="text-base font-semibold">5. Compliance, Account Restrictions &amp; Funding</h2>
          <p className="text-muted">
            Access to trading and funding features requires completion of your organisation&apos;s onboarding and
            KYC/AML verification workflow. Compliance or risk officers may apply authoritative restrictions (such as{' '}
            <code className="font-mono text-xs">NO_TRADING</code>,{' '}
            <code className="font-mono text-xs">NO_WITHDRAWAL</code>, or{' '}
            <code className="font-mono text-xs">ACCOUNT_LOCKED</code>) when required by policy or regulatory review.
            Funding and withdrawal requests transition through explicit backend verification states — a requested or
            approved withdrawal is never treated as settled until confirmed by the settlement provider.
          </p>
        </section>

        <section className="rounded border bg-card p-5 space-y-2">
          <h2 className="text-base font-semibold">6. Subscriptions, Billing &amp; Taxes</h2>
          <p className="text-muted">
            Subscription plans, usage meters, trial windows, and invoices are governed by the authoritative billing
            catalog for your organisation. Applicable value-added tax (VAT) or sales tax is calculated from your
            organisation&apos;s verified tax profile and jurisdiction rules. You may review your active plan,
            entitlements, and invoices at any time under{' '}
            <Link href="/billing" className="text-primary underline">
              Billing
            </Link>
            .
          </p>
          {supportEmail && (
            <p className="pt-2 text-xs text-muted">
              Questions regarding these Terms of Service may be directed to{' '}
              <a href={`mailto:${supportEmail}`} className="text-primary underline">
                {supportEmail}
              </a>
              .
            </p>
          )}
        </section>
      </div>
    </PageContainer>
  );
}
