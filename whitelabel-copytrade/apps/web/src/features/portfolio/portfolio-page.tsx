'use client';
import type { JSX } from 'react';

import Link from 'next/link';
import { PageContainer } from '@/layout/page-container';
import { PortfolioOverview } from './portfolio-overview';
import { HoldingsTable } from './holdings-table';
import { PnlPanel } from './pnl-panel';
import { PerformanceChart } from './performance-chart';
import { AttributionTable } from './attribution-table';
import { ValuationStatus } from './valuation-status';

export function PortfolioPage(): JSX.Element {
  return (
    <PageContainer
      title="Portfolio"
      description="Backend-authoritative NAV, PnL, holdings, performance, and strategy attribution"
      actions={
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href="/portfolio/holdings" className="rounded border px-3 py-1.5 hover:bg-accent">
            Holdings View
          </Link>
          <Link href="/portfolio/performance" className="rounded border px-3 py-1.5 hover:bg-accent">
            Performance Series
          </Link>
          <Link href="/portfolio/attribution" className="rounded border px-3 py-1.5 hover:bg-accent">
            Attribution Breakdown
          </Link>
          <Link href="/statements" className="rounded bg-primary px-3 py-1.5 text-white">
            Period Statements
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <PortfolioOverview />
        <ValuationStatus />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PnlPanel />
          <PerformanceChart />
        </div>
        <HoldingsTable />
        <AttributionTable />
      </div>
    </PageContainer>
  );
}
