// # NEW — Customer support and helpdesk route
// # NEW — customer support destination/page
'use client';

import React from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { SupportPage } from '@/features/support/support-page';
import { AppShell } from '@/layout/app-shell';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <div data-testid="customer-support-route" className="space-y-4">
          <nav
            aria-label="Customer support breadcrumb"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600"
          >
            <div className="flex items-center gap-2">
              <Link href="/dashboard" className="hover:underline">
                Dashboard
              </Link>
              <span>/</span>
              <span className="font-semibold text-slate-900">Support & Helpdesk</span>
            </div>
            <Link
              href="/activity"
              className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-50"
            >
              View Account Activity Log
            </Link>
          </nav>

          <SupportPage />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
