'use client';
import type { JSX } from 'react';

import Link from 'next/link';
import { useTenant } from '@/tenant/tenant-context';
import { TenantLogo } from '@/tenant/tenant-branding';
import { MaintenanceBanner } from '@/components/maintenance-banner';
import { EXCHANGE_VENUES } from '@/api/exchange-api';

const CAPABILITIES = [
  {
    title: 'Non-Custodial Trade-Only Execution',
    description:
      'Your capital stays on your own exchange account. Orders are routed through trade-only API credentials bound to your organisation with envelope encryption and tenant AAD.',
  },
  {
    title: 'Deterministic Pre-Trade Risk Engine',
    description:
      'Every follower order passes day-start-equity daily loss checks, drawdown limits, symbol/venue allowlists, and multi-scope kill-switches before reaching the order management system.',
  },
  {
    title: 'Authoritative Portfolio & Statements',
    description:
      'NAV, realized and unrealized PnL, fee attribution, and finalized period statements are computed and reconciled server-side with explicit stale-price and missing-FX disclosures.',
  },
  {
    title: 'Enterprise Identity & Multi-Tenant Governance',
    description:
      'Argon2id credentials, TOTP two-factor authentication with recovery codes, OIDC and SAML Single Sign-On with Single Logout, device trust, and PostgreSQL Row-Level Security.',
  },
];

const WORKFLOW_STEPS = [
  {
    step: '01',
    title: 'Create Account & Complete Onboarding',
    detail:
      'Register within your organisation, enroll in two-factor authentication, and complete the authoritative client-lifecycle onboarding workflow.',
  },
  {
    step: '02',
    title: 'Connect a Trade-Only Exchange Key',
    detail:
      'Link Binance, Bybit, OKX, Kraken, or Coinbase using trade-only permissions. Withdrawal-capable keys are rejected by policy.',
  },
  {
    step: '03',
    title: 'Subscribe to Verified Strategies',
    detail:
      'Review verified trader profiles and published strategies, select fixed, proportional, or percentage allocation sizing, and acknowledge the risk disclosure.',
  },
  {
    step: '04',
    title: 'Monitor Execution, Risk & Statements',
    detail:
      'Track copy executions, pause or stop subscriptions at any time, inspect portfolio attribution, and export finalized accounting statements.',
  },
];

export function LandingPage(): JSX.Element {
  const { tenant } = useTenant();
  const brandName = tenant?.branding?.appName ?? tenant?.name ?? 'Copy Trading Platform';
  const supportEmail = tenant?.branding?.supportEmail;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <MaintenanceBanner />

      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <TenantLogo
              className="h-9 w-9 rounded"
              fallback={
                <div className="flex h-9 w-9 items-center justify-center rounded bg-primary text-sm font-bold text-white">
                  {brandName.charAt(0).toUpperCase()}
                </div>
              }
            />
            <div>
              <span className="font-semibold tracking-tight">{brandName}</span>
              <span className="ml-2 hidden rounded bg-gray-100 px-2 py-0.5 text-xs text-muted sm:inline-block">
                Non-Custodial Copy Trading
              </span>
            </div>
          </div>

          <nav className="flex items-center gap-3 text-sm" aria-label="Public navigation">
            <Link href="/pricing" className="hidden rounded px-3 py-1.5 text-muted hover:text-foreground sm:inline-block">
              Pricing
            </Link>
            <Link href="/status" className="hidden rounded px-3 py-1.5 text-muted hover:text-foreground sm:inline-block">
              Status
            </Link>
            <Link href="/terms" className="hidden rounded px-3 py-1.5 text-muted hover:text-foreground md:inline-block">
              Terms
            </Link>
            <Link href="/privacy" className="hidden rounded px-3 py-1.5 text-muted hover:text-foreground md:inline-block">
              Privacy
            </Link>
            <Link href="/login" className="rounded border px-3 py-1.5 font-medium hover:bg-accent">
              Sign In
            </Link>
            <Link href="/register" className="rounded bg-primary px-4 py-1.5 font-medium text-white">
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="border-b bg-gradient-to-b from-gray-50 to-white py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-3xl space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted">
                <span className="h-2 w-2 rounded-full bg-green-600" aria-hidden />
                <span>Multi-Tenant Non-Custodial SaaS · Backend-Authoritative Risk &amp; Accounting</span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
                Institutional-grade crypto copy trading for {brandName}
              </h1>
              <p className="text-base text-muted sm:text-lg">
                Connect your own exchange account with trade-only API credentials, subscribe to verified strategies
                with deterministic pre-trade risk controls, and audit every fill and statement from a single
                tenant-isolated workspace.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Link
                  href="/register"
                  className="rounded bg-primary px-6 py-3 text-sm font-semibold text-white shadow-sm"
                >
                  Create Customer Account
                </Link>
                <Link
                  href="/login"
                  className="rounded border bg-card px-6 py-3 text-sm font-semibold hover:bg-accent"
                >
                  Sign In to Workspace
                </Link>
                <Link
                  href="/pricing"
                  className="rounded border bg-card px-5 py-3 text-sm font-medium text-muted hover:text-foreground"
                >
                  View Plans &amp; Entitlements
                </Link>
              </div>
            </div>

            <div className="mt-12 rounded-lg border bg-card p-4 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Supported Exchange Venues (Trade-Only Connectivity)
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {EXCHANGE_VENUES.map((venue) => (
                  <span
                    key={venue}
                    className="rounded border bg-gray-50 px-3 py-1.5 font-mono text-xs font-medium"
                  >
                    {venue}
                  </span>
                ))}
                <span className="text-xs text-muted">
                  · Envelope AES-256-GCM or HashiCorp Vault / AWS Secrets Manager
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="py-14 sm:py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold tracking-tight">Core Platform Architecture</h2>
              <p className="mt-2 text-sm text-muted">
                Built around strict tenant isolation, fail-closed execution safety gates, and verifiable portfolio
                accounting.
              </p>
            </div>
            <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
              {CAPABILITIES.map((item) => (
                <div key={item.title} className="rounded-lg border bg-card p-6 shadow-sm">
                  <h3 className="text-base font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm text-muted leading-relaxed">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t bg-gray-50 py-14 sm:py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold tracking-tight">How Copy Trading Works</h2>
              <p className="mt-2 text-sm text-muted">
                Every stage from onboarding to statement finalization is governed by the backend API.
              </p>
            </div>
            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {WORKFLOW_STEPS.map((w) => (
                <div key={w.step} className="rounded-lg border bg-card p-5">
                  <span className="font-mono text-xs font-bold text-primary">STEP {w.step}</span>
                  <h3 className="mt-2 text-sm font-semibold">{w.title}</h3>
                  <p className="mt-2 text-xs text-muted leading-relaxed">{w.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-card py-8 text-xs text-muted">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 sm:flex-row sm:items-center sm:px-6">
          <div>
            <p className="font-medium text-foreground">
              © {new Date().getFullYear()} {brandName}. All rights reserved.
            </p>
            <p className="mt-1">
              Non-custodial software platform. Digital asset trading involves substantial risk of loss.
              {supportEmail ? ` Support: ${supportEmail}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link href="/pricing" className="hover:underline">Pricing</Link>
            <Link href="/status" className="hover:underline">System Status</Link>
            <Link href="/terms" className="hover:underline">Terms of Service</Link>
            <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
            <Link href="/login" className="hover:underline">Sign In</Link>
            <Link href="/register" className="hover:underline">Register</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
