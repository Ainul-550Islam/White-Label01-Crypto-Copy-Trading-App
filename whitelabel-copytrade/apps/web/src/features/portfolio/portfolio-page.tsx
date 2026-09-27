'use client';
import { PageContainer } from '@/layout/page-container';
import { PortfolioOverview } from './portfolio-overview';
import { HoldingsTable } from './holdings-table';
import { PnlPanel } from './pnl-panel';
import { PerformanceChart } from './performance-chart';
import { AttributionTable } from './attribution-table';
import { ValuationStatus } from './valuation-status';
export function PortfolioPage(): JSX.Element {
  return (
    <PageContainer title="Portfolio" description="Backend-authoritative NAV, PnL, holdings, performance">
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
