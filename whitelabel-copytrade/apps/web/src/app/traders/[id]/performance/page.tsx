// # NEW — Customer route for trader performance detail view
'use client';

import React from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { TraderPerformancePage } from '@/features/trading/trader-performance-page';
import { AppShell } from '@/layout/app-shell';

export interface TraderPerformanceRouteProps {
  params: {
    id: string;
  };
  searchParams?: {
    window?: string;
  };
}

export default function Page({
  params,
  searchParams,
}: TraderPerformanceRouteProps): JSX.Element {
  const traderId = params.id;
  const initialWindow = searchParams?.window;

  return (
    <AuthGuard>
      <AppShell>
        <div
          data-testid="trader-performance-route"
          className="space-y-4"
        >
          <nav
            aria-label="Trader performance breadcrumb"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600"
          >
            <div className="flex items-center gap-2">
              <Link href="/traders" className="hover:underline">
                Traders Directory
              </Link>
              <span>/</span>
              <Link href={`/traders/${encodeURIComponent(traderId)}`} className="hover:underline">
                Trader {traderId}
              </Link>
              <span>/</span>
              <span className="font-semibold text-slate-900">Historical Performance</span>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/traders/compare?ids=${encodeURIComponent(traderId)}`}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-50"
              >
                Compare Side-by-Side
              </Link>
            </div>
          </nav>

          <TraderPerformancePage id={traderId} traderId={traderId} initialWindow={initialWindow} />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
