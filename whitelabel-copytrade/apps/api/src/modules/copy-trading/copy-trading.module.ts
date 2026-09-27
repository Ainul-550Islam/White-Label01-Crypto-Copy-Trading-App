import { Module, forwardRef } from '@nestjs/common';
import { CopyTradingController } from './copy-trading.controller';
import { TraderProfileService } from './trader-profile.service';
import { TraderStrategyService } from './trader-strategy.service';
import { StrategyValidationService } from './strategy-validation.service';
import { FollowerSubscriptionService } from './follower-subscription.service';
import { FollowerAllocationService } from './follower-allocation.service';
import { CopyPolicyService } from './copy-policy.service';
import { CopyOrderMapperService } from './copy-order-mapper.service';
import { FollowerRiskService } from './follower-risk.service';
import { CopyExecutionService } from './copy-execution.service';
import { TraderPerformanceService } from './trader-performance.service';
import { TraderRankingService } from './trader-ranking.service';
import { CopyReconciliationService } from './copy-reconciliation.service';
import { CopySubscriptionRepository } from './copy-subscription.repository';
import { CopyExecutionRepository } from './copy-execution.repository';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { ExchangesModule } from '../exchanges/exchanges.module';
import { BillingModule } from '../billing/billing.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { SecurityModule } from '../security/security.module';

/**
 * Wiring with forwardRef only when needed, integrating Billing/Enforcement/Compliance/Security/Exchanges/Execution/Fees/Usage/Notifications/distributed locks.
 */
@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ExchangesModule),
    forwardRef(() => BillingModule),
    forwardRef(() => ComplianceModule),
    forwardRef(() => SecurityModule),
  ],
  controllers: [CopyTradingController],
  providers: [
    TraderProfileService,
    TraderStrategyService,
    StrategyValidationService,
    FollowerSubscriptionService,
    FollowerAllocationService,
    CopyPolicyService,
    CopyOrderMapperService,
    FollowerRiskService,
    CopyExecutionService,
    TraderPerformanceService,
    TraderRankingService,
    CopyReconciliationService,
    CopySubscriptionRepository,
    CopyExecutionRepository,
  ],
  exports: [
    TraderProfileService,
    TraderStrategyService,
    StrategyValidationService,
    FollowerSubscriptionService,
    FollowerAllocationService,
    CopyPolicyService,
    CopyOrderMapperService,
    FollowerRiskService,
    CopyExecutionService,
    TraderPerformanceService,
    TraderRankingService,
    CopyReconciliationService,
    CopySubscriptionRepository,
    CopyExecutionRepository,
  ],
})
export class CopyTradingModule {}
