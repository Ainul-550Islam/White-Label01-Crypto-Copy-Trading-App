// # NEW — subscription detail route
// # MODIFY — execution detail linkage
// # MODIFY — reconciliation status integration
'use client';
import type { JSX } from 'react';

import React, { use } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { CopySubscriptionDetailPage } from '@/features/trading/copy-subscription-detail-page';
import { AppShell } from '@/layout/app-shell';

export interface CopySubscriptionDetailRouteProps {
  params: Promise<{ subscriptionId: string }>;
}

export default function Page({ params }: CopySubscriptionDetailRouteProps): JSX.Element {
  const { subscriptionId } = use(params);

  return (
    <AuthGuard>
      <AppShell>
        <div data-testid="copy-subscription-detail-route" className="space-y-4">
          <nav
            aria-label="Subscription detail breadcrumb"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600"
          >
            <div className="flex items-center gap-2">
              <Link href="/copy-trading" className="hover:underline">
                Copy Subscriptions
              </Link>
              <span>/</span>
              <span className="font-semibold text-slate-900">Subscription {subscriptionId}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/copy-trading/${encodeURIComponent(subscriptionId)}/settings`}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-50"
              >
                Edit Allocation & Risk
              </Link>
              <Link
                href={`/copy-trading/${encodeURIComponent(subscriptionId)}/positions`}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-50"
              >
                Copied Positions
              </Link>
              <Link
                href={`/copy-trading/${encodeURIComponent(subscriptionId)}/orders`}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-50"
              >
                Copied Orders
              </Link>
            </div>
          </nav>

          <CopySubscriptionDetailPage subscriptionId={subscriptionId} />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
