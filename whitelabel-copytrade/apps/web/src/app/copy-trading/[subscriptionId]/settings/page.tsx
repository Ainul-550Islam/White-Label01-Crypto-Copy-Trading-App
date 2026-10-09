// # NEW — subscription settings route
'use client';
import type { JSX } from 'react';

import React, { use } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { CopySettingsPage } from '@/features/trading/copy-settings-page';
import { AppShell } from '@/layout/app-shell';

export interface CopySubscriptionSettingsRouteProps {
  params: Promise<{ subscriptionId: string }>;
}

export default function Page({ params }: CopySubscriptionSettingsRouteProps): JSX.Element {
  const { subscriptionId } = use(params);

  return (
    <AuthGuard>
      <AppShell>
        <div data-testid="copy-subscription-settings-route" className="space-y-4">
          <nav
            aria-label="Subscription settings breadcrumb"
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
              <span className="font-semibold text-slate-900">Allocation & Risk Settings</span>
            </div>
          </nav>

          <CopySettingsPage subscriptionId={subscriptionId} />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
