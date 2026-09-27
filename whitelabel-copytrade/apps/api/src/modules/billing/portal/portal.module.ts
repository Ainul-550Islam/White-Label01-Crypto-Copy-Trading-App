import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../infrastructure/prisma/prisma.module';
import { PlansService } from '../plans.service';
import { SubscriptionsService } from '../subscriptions.service';
import { EnforcementModule } from '../enforcement/enforcement.module';
import { PaymentsModule } from '../payments/payments.module';
import { FinanceModule } from '../finance/finance.module';

import { BillingPortalService } from './billing-portal.service';
import { BillingPortalController } from './billing-portal.controller';
import { PlanChangeService } from './plan-change.service';
import { SubscriptionManagementService } from './subscription-management.service';
import { BillingInvoiceQueryService } from './billing-invoice-query.service';
import { BillingPaymentHistoryService } from './billing-payment-history.service';
import { BillingUsageSummaryService } from './billing-usage-summary.service';

/**
 * PortalModule aggregates canonical billing data for customer-facing portal.
 * Reuses Part1 Plan Catalog, Part2 Enforcement, Part3 Checkout/Payment/Webhook,
 * Part4 Invoice/Ledger/Tax/Refund/Dunning.
 * No second source of truth.
 */
@Module({
  imports: [
    PrismaModule,
    EnforcementModule,
    forwardRef(() => PaymentsModule),
    forwardRef(() => FinanceModule),
  ],
  controllers: [BillingPortalController],
  providers: [
    BillingPortalService,
    BillingUsageSummaryService,
    BillingInvoiceQueryService,
    BillingPaymentHistoryService,
    SubscriptionManagementService,
    PlanChangeService,
  ],
  exports: [
    BillingPortalService,
    BillingUsageSummaryService,
    BillingInvoiceQueryService,
    BillingPaymentHistoryService,
    SubscriptionManagementService,
    PlanChangeService,
  ],
})
export class PortalModule {}
