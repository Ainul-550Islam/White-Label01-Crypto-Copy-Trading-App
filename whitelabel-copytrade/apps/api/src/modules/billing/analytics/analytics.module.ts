import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../infrastructure/prisma/prisma.module';
import { RedisModule } from '../../../infrastructure/redis/redis.module';
import { BillingModule } from '../billing.module';
import { FinanceModule } from '../finance/finance.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsageModule } from '../usage/usage.module';
import { FeesModule } from '../fees/fees.module';

import { RevenueAnalyticsService } from './revenue-analytics.service';
import { SubscriptionAnalyticsService } from './subscription-analytics.service';
import { ChurnAnalyticsService } from './churn-analytics.service';
import { MrrCalculationService } from './mrr-calculation.service';
import { ArrCalculationService } from './arr-calculation.service';
import { RevenueRecognitionService } from './revenue-recognition.service';
import { CashflowAnalyticsService } from './cashflow-analytics.service';
import { BillingHealthService } from './billing-health.service';
import { CustomerValueService } from './customer-value.service';
import { PlanPerformanceService } from './plan-performance.service';
import { RevenueCohortService } from './revenue-cohort.service';
import { AnalyticsReconciliationService } from './analytics-reconciliation.service';
import { AnalyticsCacheService } from './analytics-cache.service';
import { AnalyticsController } from './analytics.controller';

/**
 * NestJS wiring for analytics services, repositories/integrations, cache, controller, DTOs, and existing billing modules.
 * Integrates with BillingModule, FinanceModule, PaymentsModule, UsageModule, FeesModule, tenant/customer services, Redis/cache.
 * All analytics are read-only, derived from canonical billing data, Decimal-safe, tenant-isolated.
 */
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    forwardRef(() => BillingModule),
    forwardRef(() => FinanceModule),
    forwardRef(() => PaymentsModule),
    forwardRef(() => UsageModule),
    forwardRef(() => FeesModule),
  ],
  controllers: [AnalyticsController],
  providers: [
    // Core calculation engines
    MrrCalculationService,
    ArrCalculationService,
    RevenueRecognitionService,
    CashflowAnalyticsService,
    BillingHealthService,
    CustomerValueService,
    PlanPerformanceService,
    RevenueCohortService,

    // Higher-level analytics
    SubscriptionAnalyticsService,
    ChurnAnalyticsService,
    RevenueAnalyticsService,

    // Infrastructure
    AnalyticsCacheService,
    AnalyticsReconciliationService,
  ],
  exports: [
    MrrCalculationService,
    ArrCalculationService,
    RevenueRecognitionService,
    CashflowAnalyticsService,
    BillingHealthService,
    CustomerValueService,
    PlanPerformanceService,
    RevenueCohortService,
    SubscriptionAnalyticsService,
    ChurnAnalyticsService,
    RevenueAnalyticsService,
    AnalyticsCacheService,
    AnalyticsReconciliationService,
  ],
})
export class AnalyticsModule {}
