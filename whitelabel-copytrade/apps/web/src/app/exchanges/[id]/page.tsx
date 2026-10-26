// # Displays venue capabilities on exchange detail page
// # MODIFY — capability integration
'use client';
import type { JSX } from 'react';

import React, { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AuthGuard } from '@/auth/auth.guard';
import { ExchangeAccountDetail } from '@/features/exchanges/exchange-account-detail';
import { ExchangeCapabilities } from '@/features/exchanges/exchange-capabilities';
import { AccountCapabilityHealth } from '@/features/exchanges/account-capability-health';
import { accountHealthApi } from '@/api/exchange-ops-api';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';

/**
 * The live capability matrix for one account.
 *
 * Kept small and separate from the page body so the account header renders even
 * while the health read is in flight: "we are still checking" must not look like
 * "there is nothing to see". A failed read is stated as failed - an account screen
 * that silently drops its health panel reads as healthy.
 */
function AccountHealthPanel({ accountId }: { accountId: string }): JSX.Element {
  const healthQuery = useQuery({
    queryKey: ['exchange-account-capability-health', accountId],
    queryFn: () => accountHealthApi.getCapabilityHealth(accountId),
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });

  if (healthQuery.isLoading) {
    return <p className="text-xs text-muted">Checking what this key is allowed to do…</p>;
  }
  if (healthQuery.isError || !healthQuery.data) {
    return (
      <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" role="status">
        The permissions on this key could not be checked just now. That is not the same as “this key is fine” — verify
        before relying on it.
      </p>
    );
  }
  return (
    <div className="grid gap-3">
      <AccountCapabilityHealth
        health={{
          accountId: healthQuery.data.accountId,
          venue: healthQuery.data.venue,
          environment: healthQuery.data.environment,
          overall: healthQuery.data.overall,
          capabilities: healthQuery.data.capabilities,
          verifiedAt: healthQuery.data.verifiedAt,
          evidenceAgeMs: healthQuery.data.evidenceAgeMs,
          requiresAction: healthQuery.data.requiresAction,
        }}
      />
      <Link
        href={`/exchanges/${encodeURIComponent(accountId)}/rotate`}
        className="w-fit rounded border px-3 py-1 text-xs font-medium"
      >
        Replace this key
      </Link>
    </div>
  );
}

export interface ExchangeDetailRouteProps {
  params: Promise<{ id: string }>;
}

export default function Page({ params }: ExchangeDetailRouteProps): JSX.Element {
  const accountId = use(params).id;

  return (
    <AuthGuard>
      <AppShell>
        <PageContainer title="Exchange Account & Venue Capability Detail">
          <div data-testid="exchange-detail-route" className="space-y-6">
            <nav
              aria-label="Exchange account breadcrumb"
              className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600"
            >
              <div className="flex items-center gap-2">
                <Link href="/exchanges" className="hover:underline">
                  Connected Exchanges
                </Link>
                <span>/</span>
                <span className="font-semibold text-slate-900">Account {accountId}</span>
              </div>
            </nav>

            <ExchangeAccountDetail id={accountId} />

            <section aria-label="Key permissions and account health" className="grid gap-3">
              {/* The capability matrix renders the READ_ONLY / TRADE / WITHDRAW_ENABLED
                  badge from its own rows, so there is one badge and one source. */}
              <AccountHealthPanel accountId={accountId} />
            </section>

            <section aria-label="Reference venue capability matrix">
              <ExchangeCapabilities showAllVenues />
            </section>
          </div>
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
