// # NEW — copied positions route
'use client';

import React from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { CopiedPositionsPage } from '@/features/trading/copied-positions-page';
import { AppShell } from '@/layout/app-shell';

export interface CopySubscriptionPositionsRouteProps {
  params: {
    subscriptionId: string;
  };
}

export default function Page({ params }: CopySubscriptionPositionsRouteProps): JSX.Element {
  const { subscriptionId } = params;

  return (
    <AuthGuard>
      <AppShell>
        <div data-testid="copy-subscription-positions-route" className="space-y-4">
          <nav
            aria-label="Subscription positions breadcrumb"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600"
          >
            <div className="flex items-center gap-2">
              <Link href="/copy-trading" className="hover:underline">
                Copy Subscriptions
              </Link>
              <span>/</span>
              <Link
                href={`/copy-trading/${encodeURIComponent(subscriptionId)}`}
                className="hover:underline"
              >
                Subscription {subscriptionId}
              </Link>
              <span>/</span>
              <span className="font-semibold text-slate-900">Copied Positions</span>
            </div>
          </nav>

          <CopiedPositionsPage subscriptionId={subscriptionId} />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
