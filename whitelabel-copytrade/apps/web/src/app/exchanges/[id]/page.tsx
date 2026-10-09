// # Displays venue capabilities on exchange detail page
// # MODIFY — capability integration
'use client';
import type { JSX } from 'react';

import React, { use } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { ExchangeAccountDetail } from '@/features/exchanges/exchange-account-detail';
import { ExchangeCapabilities } from '@/features/exchanges/exchange-capabilities';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';

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

            <section aria-label="Reference venue capability matrix">
              <ExchangeCapabilities showAllVenues />
            </section>
          </div>
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
