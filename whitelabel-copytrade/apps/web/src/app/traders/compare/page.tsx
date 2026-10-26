// # NEW — side-by-side trader comparison route
'use client';
import type { JSX } from 'react';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AuthGuard } from '@/auth/auth.guard';
import { TraderComparisonPage } from '@/features/trading/trader-comparison-page';
import { AppShell } from '@/layout/app-shell';

function TraderComparisonRouteContent(): JSX.Element {
  const searchParams = useSearchParams();
  const idsParam = searchParams?.get('ids') ?? '';
  const initialTraderIds = idsParam
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 4);

  return (
    <AuthGuard>
      <AppShell>
        <div data-testid="trader-comparison-route" className="space-y-4">
          <nav
            aria-label="Trader comparison breadcrumb"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600"
          >
            <div className="flex items-center gap-2">
              <Link href="/traders" className="hover:underline">
                Traders Directory
              </Link>
              <span>/</span>
              <span className="font-semibold text-slate-900">
                Side-by-Side Trader Comparison (Max 4)
              </span>
            </div>
            <Link
              href="/leaderboard"
              className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-50"
            >
              View Leaderboard Rankings
            </Link>
          </nav>

          <TraderComparisonPage initialIds={initialTraderIds} />
        </div>
      </AppShell>
    </AuthGuard>
  );
}

export default function Page(): JSX.Element {
  return <Suspense fallback={<p role="status" className="p-4 text-sm">Loading trader comparison…</p>}><TraderComparisonRouteContent /></Suspense>;
}
