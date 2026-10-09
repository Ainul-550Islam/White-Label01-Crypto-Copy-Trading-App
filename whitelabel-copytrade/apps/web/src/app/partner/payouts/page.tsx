// # NEW — Partner payout request and history route
// # NEW — payout status/history route
'use client';
import type { JSX } from 'react';

import React from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { PartnerPayouts } from '@/features/partner/partner-payouts';
import { AppShell } from '@/layout/app-shell';

export default function PartnerPayoutsPage(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <div data-testid="partner-payouts-route" className="space-y-4">
          <nav
            aria-label="Partner payouts navigation"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600"
          >
            <div className="flex items-center gap-3">
              <Link href="/partner" className="hover:underline">
                Partner & IB Overview
              </Link>
              <span>/</span>
              <Link href="/partner/commissions" className="hover:underline">
                Commission Ledger
              </Link>
              <span>/</span>
              <span className="font-semibold text-slate-900">Payouts & Settlements</span>
            </div>
          </nav>

          <PartnerPayouts />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
