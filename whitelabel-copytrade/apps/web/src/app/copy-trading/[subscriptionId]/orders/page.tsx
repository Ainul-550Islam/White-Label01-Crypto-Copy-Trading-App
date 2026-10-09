// # NEW — copied order history route
'use client';
import type { JSX } from 'react';

import React, { use } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { CopiedOrdersPage } from '@/features/trading/copied-orders-page';
import { AppShell } from '@/layout/app-shell';

export interface CopySubscriptionOrdersRouteProps {
  params: Promise<{ subscriptionId: string }>;
}

export default function Page({ params }: CopySubscriptionOrdersRouteProps): JSX.Element {
  const { subscriptionId } = use(params);

  return (
    <AuthGuard>
      <AppShell>
        <div data-testid="copy-subscription-orders-route" className="space-y-4">
          <nav
            aria-label="Subscription orders breadcrumb"
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
              <span className="font-semibold text-slate-900">Copied Orders History</span>
            </div>
          </nav>

          <CopiedOrdersPage subscriptionId={subscriptionId} />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
