// # NEW — Customer route for copied open/closed positions
'use client';

import React from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { CopiedPositionsPage } from '@/features/trading/copied-positions-page';
import { AppShell } from '@/layout/app-shell';

export default function CopyTradingPositionsRoute(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <div data-testid="copy-trading-positions-route" className="space-y-4">
          <nav
            aria-label="Copied positions navigation"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600"
          >
            <div className="flex items-center gap-2">
              <Link href="/copy-trading" className="hover:underline">
                Copy Trading
              </Link>
              <span>/</span>
              <span className="font-semibold text-slate-900">Copied Open & Closed Positions</span>
            </div>
            <Link
              href="/copy-trading/orders"
              className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-50"
            >
              View Copied Orders History
            </Link>
          </nav>

          <CopiedPositionsPage />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
