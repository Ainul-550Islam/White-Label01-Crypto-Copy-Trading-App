// # NEW — Customer activity & audit log route
// # NEW — customer activity route
'use client';

import React from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/auth/auth.guard';
import { CustomerActivityPage } from '@/features/activity/customer-activity-page';
import { AppShell } from '@/layout/app-shell';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <div data-testid="customer-activity-route" className="space-y-4">
          <nav
            aria-label="Customer activity breadcrumb"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600"
          >
            <div className="flex items-center gap-2">
              <Link href="/dashboard" className="hover:underline">
                Dashboard
              </Link>
              <span>/</span>
              <span className="font-semibold text-slate-900">
                Customer Activity & Audit Trail
              </span>
            </div>
            <Link
              href="/notifications"
              className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-50"
            >
              View Notifications
            </Link>
          </nav>

          <CustomerActivityPage />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
