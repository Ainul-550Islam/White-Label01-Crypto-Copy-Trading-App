// # NEW — Partner commission ledger route
// # NEW — commission ledger route
'use client';
import type { JSX } from 'react';

import React from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { CommissionLedger } from '@/features/partner/commission-ledger';
import { AppShell } from '@/layout/app-shell';

export default function PartnerCommissionsPage(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <div data-testid="partner-commissions-route" className="space-y-4">
          <nav
            aria-label="Partner commissions navigation"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600"
          >
            <div className="flex items-center gap-3">
              <Link href="/partner" className="hover:underline">
                Partner & IB Overview
              </Link>
              <span>/</span>
              <Link href="/partner/referrals" className="hover:underline">
                Referrals & Campaigns
              </Link>
              <span>/</span>
              <span className="font-semibold text-slate-900">Commission Ledger</span>
              <Link href="/partner/payouts" className="hover:underline">
                Payouts & Settlements
              </Link>
            </div>
          </nav>

          <CommissionLedger />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
