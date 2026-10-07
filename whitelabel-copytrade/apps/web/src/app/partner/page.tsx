// # NEW — Partner/IB portal dashboard route
// # NEW — partner portal overview route
'use client';

import React from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { PartnerDashboard } from '@/features/partner/partner-dashboard';
import { AppShell } from '@/layout/app-shell';

export default function PartnerPortalPage(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <div data-testid="partner-portal-route" className="space-y-4">
          <nav
            aria-label="Partner portal navigation"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600"
          >
            <div className="flex items-center gap-3">
              <span className="font-semibold text-slate-900">Partner & IB Overview</span>
              <Link href="/partner/referrals" className="hover:underline">
                Referrals & Campaigns
              </Link>
              <Link href="/partner/commissions" className="hover:underline">
                Commission Ledger
              </Link>
              <Link href="/partner/payouts" className="hover:underline">
                Payouts & Settlements
              </Link>
            </div>
          </nav>

          <PartnerDashboard />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
