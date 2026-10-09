// # MODIFY — strategy detail integration
'use client';
import type { JSX } from 'react';

import React, { use } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { StrategyDetailPage } from '@/features/trading/strategy-detail-page';
import { AppShell } from '@/layout/app-shell';

export interface StrategyDetailRouteProps {
  params: Promise<{ id: string }>;
}

export default function Page({ params }: StrategyDetailRouteProps): JSX.Element {
  const strategyId = use(params).id;

  return (
    <AuthGuard>
      <AppShell>
        <div data-testid="strategy-detail-route" className="space-y-4">
          <nav
            aria-label="Strategy detail breadcrumb"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600"
          >
            <div className="flex items-center gap-2">
              <Link href="/strategies" className="hover:underline">
                Strategy Marketplace
              </Link>
              <span>/</span>
              <span className="font-semibold text-slate-900">Strategy {strategyId}</span>
            </div>
            <Link
              href="/copy-trading"
              className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-50"
            >
              My Copy Subscriptions
            </Link>
          </nav>

          <StrategyDetailPage id={strategyId} />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
