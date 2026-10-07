// # Responsibility: shows the authenticated customer's own exposure and provenance-qualified concentration/correlation analysis.

'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { CustomerExposurePanel } from '@/features/portfolio/customer-exposure-panel';
import { ConcentrationRiskPanel } from '@/features/trading/concentration-risk-panel';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import Link from 'next/link';

export default function Page(): JSX.Element {
  return (
    <AuthGuard>
      <AppShell>
        <PageContainer
          title="Exposure"
          description="Your non-simulated positions and open-order commitments, with explicit price provenance and incomplete-data states."
        >
          <div className="space-y-8">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
              <p className="text-sm text-muted">Configure account-owner-wide ceilings for concurrent positions and open OMS orders.</p>
              <Link href="/risk/position-limits" className="rounded-md border px-3 py-2 text-sm font-medium">
                Position and order limits
              </Link>
            </div>
            <CustomerExposurePanel />
            <ConcentrationRiskPanel />
          </div>
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
