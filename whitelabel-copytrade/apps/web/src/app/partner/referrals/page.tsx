// # NEW — Partner referral link and campaign management route
// # NEW — referral/campaign route
'use client';
import type { JSX } from 'react';

import React from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { ReferralManager } from '@/features/partner/referral-manager';
import { AppShell } from '@/layout/app-shell';

export default function PartnerReferralsPage(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <div data-testid="partner-referrals-route" className="space-y-4">
          <nav
            aria-label="Partner referrals navigation"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600"
          >
            <div className="flex items-center gap-3">
              <Link href="/partner" className="hover:underline">
                Partner & IB Overview
              </Link>
              <span>/</span>
              <span className="font-semibold text-slate-900">Referrals & Campaigns</span>
              <Link href="/partner/commissions" className="hover:underline">
                Commission Ledger
              </Link>
              <Link href="/partner/payouts" className="hover:underline">
                Payouts & Settlements
              </Link>
            </div>
          </nav>

          <ReferralManager />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
