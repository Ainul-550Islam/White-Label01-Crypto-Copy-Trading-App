import { Module, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { AccountingPolicyService } from './accounting-policy.service';
import { AccountingEventRepository } from './accounting-event.repository';
import { AccountingEventService } from './accounting-event.service';
import { CashLedgerService } from './cash-ledger.service';
import { PositionAccountingService } from './position-accounting.service';
import { CostBasisService } from './cost-basis.service';
import { ValuationService } from './valuation.service';
import { NavService } from './nav.service';
import { PnLService } from './pnl.service';
import { PerformanceService } from './performance.service';
import { BenchmarkService } from './benchmark.service';
import { AttributionService } from './attribution.service';
import { PortfolioSnapshotService } from './portfolio-snapshot.service';
import { AccountingPeriodService } from './accounting-period.service';
import { PeriodCloseService } from './period-close.service';
import { StatementService } from './statement.service';
import { ReportExportService } from './report-export.service';
import { AccountingReconciliationService } from './accounting-reconciliation.service';
import { AccountingAdjustmentService } from './accounting-adjustment.service';
import { InvestorVisibilityService } from './investor-visibility.service';
import { PortfolioAuditService } from './portfolio-audit.service';
import { PortfolioAccountingController } from './portfolio-accounting.controller';

/**
 * Part 19 — Institutional Portfolio Accounting, Performance & Investor Reporting Control Plane
 *
 * Chain:
 * Strategy/Copy→Risk+Compliance→OMS→Execution→Exchange→Fills/Positions/Balances→Fees/Finance/Usage→
 * Portfolio Accounting→Cash/CostBasis/Valuation→NAV+PnL→Performance+Attribution→Snapshots+PeriodClose→
 * Statements/Reports→Reconciliation→Operations→Immutable Audit
 *
 * Rules:
 * - No placeholder/TODO/fake results/prices/fills/balances
 * - Decimal/string/minor-unit arithmetic
 * - Every event traceable sourceType/sourceId/sourceTimestamp
 * - Idempotency mandatory
 * - Closed periods immutable, corrections reversal only
 * - Never calculate from client numbers
 * - Tenant isolation, platform RBAC, investor visibility respects ownership
 * - No credential/secret exposure
 * - Exports from persisted records
 * - Preserve methodology/version
 */

@Module({
  controllers: [PortfolioAccountingController],
  providers: [
    PrismaService,
    AppConfigService,
    AccountingPolicyService,
    AccountingEventRepository,
    AccountingEventService,
    CashLedgerService,
    PositionAccountingService,
    CostBasisService,
    ValuationService,
    NavService,
    PnLService,
    PerformanceService,
    BenchmarkService,
    AttributionService,
    PortfolioSnapshotService,
    AccountingPeriodService,
    PeriodCloseService,
    StatementService,
    ReportExportService,
    AccountingReconciliationService,
    AccountingAdjustmentService,
    InvestorVisibilityService,
    PortfolioAuditService,
  ],
  exports: [
    AccountingPolicyService,
    AccountingEventRepository,
    AccountingEventService,
    CashLedgerService,
    PositionAccountingService,
    CostBasisService,
    ValuationService,
    NavService,
    PnLService,
    PerformanceService,
    BenchmarkService,
    AttributionService,
    PortfolioSnapshotService,
    AccountingPeriodService,
    PeriodCloseService,
    StatementService,
    ReportExportService,
    AccountingReconciliationService,
    AccountingAdjustmentService,
    InvestorVisibilityService,
    PortfolioAuditService,
  ],
})
export class PortfolioAccountingModule {}
