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
// The canonical linked-period TWR arithmetic. TraderPerformanceService depends on it, so it must
// be a provider of this module; it was previously referenced only by a service that no module
// registered, which made the whole engine unreachable at runtime.
import { PerformanceCalculationService } from './performance-calculation.service';
import { PerformanceBenchmarkService } from './performance-benchmark.service';
import { PerformanceBenchmarkController } from './performance-benchmark.controller';
import { AllocationRebalanceController } from './allocation-rebalance.controller';
import { AllocationValuationController } from './allocation-valuation.controller';
import { AllocationRebalanceService } from './allocation-rebalance.service';
import { AllocationValuationRepository } from './allocation-valuation.repository';
import { RiskModule } from '../risk/risk.module';
import { TraderRankingService } from './trader-ranking.service';
import { CopyReconciliationService } from './copy-reconciliation.service';
import { CopySubscriptionRepository } from './copy-subscription.repository';
import { CopyExecutionRepository } from './copy-execution.repository';
import { LeaderEventSourceService } from './leader-event-source.service';
import { LeaderEventIngestionService } from './leader-event-ingestion.service';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { ExchangesModule } from '../exchanges/exchanges.module';
import { BillingModule } from '../billing/billing.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { SecurityModule } from '../security/security.module';
import { OmsModule } from '../oms/oms.module';
import { OperationsModule } from '../operations/operations.module';

/**
 * Wiring with forwardRef only when needed, integrating Billing/Enforcement/Compliance/Security/Exchanges/Execution/Fees/Usage/Notifications/distributed locks.
 */
@Module({
  imports: [
    PrismaModule,
    // Exports TraderRiskScoreService, which the public trader profile publishes. RiskModule has no
    // imports of its own, so this direction cannot form a cycle.
    RiskModule,
    forwardRef(() => ExchangesModule),
    forwardRef(() => BillingModule),
    forwardRef(() => ComplianceModule),
    forwardRef(() => SecurityModule),
    // Phase 3: CopyExecutionService dispatches through the OMS
    // (OrderIntentService + OrderRoutingService). OmsModule imports this
    // module too, hence forwardRef on both sides.
    forwardRef(() => OmsModule),
    // FollowerSubscriptionService enforces trading maintenance windows through
    // MaintenanceModeService. OperationsModule imports this module too.
    forwardRef(() => OperationsModule),
  ],
  // AllocationRebalanceController and AllocationRebalanceService existed but were declared by no
  // module, so the preview route was unreachable in a running application while its controller spec
  // passed against a hand-constructed instance. A route that only tests can reach is not a route.
  controllers: [CopyTradingController, PerformanceBenchmarkController, AllocationRebalanceController, AllocationValuationController],
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
    PerformanceCalculationService,
    PerformanceBenchmarkService,
    TraderPerformanceService,
    TraderRankingService,
    CopyReconciliationService,
    CopySubscriptionRepository,
    CopyExecutionRepository,
    LeaderEventSourceService,
    LeaderEventIngestionService,
    AllocationRebalanceService,
    AllocationValuationRepository,
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
    PerformanceCalculationService,
    TraderPerformanceService,
    TraderRankingService,
    CopyReconciliationService,
    CopySubscriptionRepository,
    CopyExecutionRepository,
    LeaderEventSourceService,
    LeaderEventIngestionService,
  ],
})
export class CopyTradingModule {}
