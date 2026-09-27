import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../infrastructure/prisma/prisma.module';
import { FinanceModule } from '../finance/finance.module';
import { PaymentsModule } from '../payments/payments.module';
import { EnforcementModule } from '../enforcement/enforcement.module';
import { BillingNotificationsModule } from '../notifications/notifications.module';

// Fee domain
import { FeePolicyService } from './fee-policy.service';
import { FeeCalculatorService } from './fee-calculator.service';
import { FeeAccrualService } from './fee-accrual.service';
import { FeeAccrualRepository } from './fee-accrual.repository';
import { FeeLedgerService } from './fee-ledger.service';
import { FeeSettlementService } from './fee-settlement.service';
import { FeeSettlementRepository } from './fee-settlement.repository';
import { FeeReconciliationService } from './fee-reconciliation.service';
import { FeeAuditService } from './fee-audit.service';
import { FeeAnalyticsService } from './fee-analytics.service';

// Payout domain
import { PayoutProviderFactory } from './payout-provider.factory';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';

/**
 * Platform Fees, Performance Fees, Revenue Settlement, Trader/Follower Fee Accrual, Payout Foundation.
 * Real commercial fee pipeline:
 * Source -> Validate -> Policy -> Calculation -> Accrual -> Ledger -> Settlement -> Payout -> Audit -> Reconciliation
 * Reuses Part1 Plan Catalog, Part2 Enforcement, Part3 Payments, Part4 Finance, Part5 Portal, Part6 SaaS Admin.
 * No second source of truth.
 */
@Module({
  imports: [PrismaModule, FinanceModule, forwardRef(() => PaymentsModule), EnforcementModule, forwardRef(() => BillingNotificationsModule)],
  providers: [
    // Fee policy & calculation
    FeePolicyService,
    FeeCalculatorService,

    // Accrual
    FeeAccrualRepository,
    FeeAccrualService,

    // Ledger
    FeeLedgerService,

    // Settlement
    FeeSettlementRepository,
    FeeSettlementService,

    // Payout
    PayoutProviderFactory,
    PayoutRepository,
    PayoutService,

    // Reconciliation, Audit, Analytics
    FeeReconciliationService,
    FeeAuditService,
    FeeAnalyticsService,
  ],
  exports: [
    FeePolicyService,
    FeeCalculatorService,
    FeeAccrualService,
    FeeAccrualRepository,
    FeeLedgerService,
    FeeSettlementService,
    FeeSettlementRepository,
    PayoutService,
    PayoutRepository,
    PayoutProviderFactory,
    FeeReconciliationService,
    FeeAuditService,
    FeeAnalyticsService,
  ],
})
export class FeesModule {}
