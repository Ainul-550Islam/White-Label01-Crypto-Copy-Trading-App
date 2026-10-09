// # NEW — Customer route for copied order history
'use client';
import type { JSX } from 'react';

import React from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { CopiedOrdersPage } from '@/features/trading/copied-orders-page';
import { AppShell } from '@/layout/app-shell';

export default function CopyTradingOrdersRoute(): JSX.Element {
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

          <CopiedOrdersPage />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
