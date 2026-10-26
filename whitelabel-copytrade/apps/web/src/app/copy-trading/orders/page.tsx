// # NEW — Customer route for copied order history
'use client';
import type { JSX } from 'react';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { CopiedOrdersPage } from '@/features/trading/copied-orders-page';
import { AppShell } from '@/layout/app-shell';

function CopyTradingOrdersRouteContent(): JSX.Element {
  const subscriptionId = useSearchParams().get('subscriptionId');

  return (
    <AuthGuard>
      <AppShell>
        <div data-testid="copy-trading-orders-route" className="space-y-4">
          <nav
            aria-label="Copied orders navigation"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600"
          >
            <div className="flex items-center gap-2">
              <Link href="/copy-trading" className="hover:underline">
                Copy Trading
              </Link>
              <span>/</span>
              <span className="font-semibold text-slate-900">Copied Order History</span>
            </div>
            <Link
              href="/copy-trading/positions"
              className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-50"
            >
              View Copied Positions
            </Link>
          </nav>

          {subscriptionId ? (
            <CopiedOrdersPage subscriptionId={subscriptionId} />
          ) : (
            <section role="status" className="rounded border bg-card p-4 text-sm">
              Choose a copy subscription to view its order history. Open a subscription and select this view.
            </section>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  );
}

export default function CopyTradingOrdersRoute(): JSX.Element {
  return <Suspense fallback={<p role="status" className="p-4 text-sm">Loading subscription view…</p>}><CopyTradingOrdersRouteContent /></Suspense>;
}
