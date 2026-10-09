import { Module } from '@nestjs/common';
import { RiskManagementController } from './risk.controller';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { PortfolioExposureService } from './portfolio-exposure.service';
import { PositionRiskService } from './position-risk.service';
import { OrderRiskService } from './order-risk.service';
import { MarginRiskService } from './margin-risk.service';
import { LiquidationRiskService } from './liquidation-risk.service';
import { ConcentrationRiskService } from './concentration-risk.service';
import { DrawdownRiskService } from './drawdown-risk.service';
import { DailyLossLimitService } from './daily-loss-limit.service';
import { LeverageRiskService } from './leverage-risk.service';
import { LeveragePolicyService } from '../risk/leverage-policy.service';
import { CorrelationRiskService } from './correlation-risk.service';
import { VarRiskService } from './var-risk.service';
import { StressTestService } from './stress-test.service';
import { RiskManagementSnapshotRepository } from './risk-snapshot.repository';
import { RiskEventService } from './risk-event.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { KillSwitchOrchestratorService } from './kill-switch-orchestrator.service';
import { RiskDecisionService } from './risk-decision.service';
import { RiskReconciliationService } from './risk-reconciliation.service';
import { UserPositionLimitController } from './user-position-limit.controller';
import { PositionLimitService } from '../risk/position-limit.service';
import { CustomerExposureService } from './customer-exposure.service';

/**
 * Part 16 — Institutional Risk Management Module
 *
 * Wiring all services/repos/controller integrating:
 * - existing RiskModule (per-account risk config)
 * - ExecutionEngine / ExchangesModule (via Prisma canonical state, not direct import to avoid circular)
 * - ComplianceModule, SecurityModule, CopyTradingModule, FeesModule, UsageModule, NotificationsModule
 * - Redis/locks, existing KillSwitch, audit
 *
 * Architecture:
 * Canonical State → Risk Policy → Exposure → Position → Margin → Leverage → Liquidation → Concentration → Drawdown → Daily Loss → Correlation → VaR → Stress → Compliance → Security → Exchange Health → Circuit Breaker → KillSwitch → Unified Decision → Existing Execution/Live Gate
 *
 * Never alternate execution engine, never direct exchange order, existing KillSwitch authoritative,
 * compliance BLOCK prevents ALLOW, security BLOCK prevents ALLOW, stale exchange health blocks live,
 * stale-data explicit, Decimal-safe, no fake values, explainable.
 */

@Module({
  controllers: [
    RiskManagementController,
    // Self-service user-wide position/open-order ceilings. The controller existed and was
    // decorated for permissions, but was never listed here, so no route was mounted and a
    // customer's configured limit was unreachable.
    UserPositionLimitController,
  ],
  providers: [
    InstitutionalRiskPolicyService,
    PortfolioExposureService,
    PositionRiskService,
    OrderRiskService,
    MarginRiskService,
    LiquidationRiskService,
    ConcentrationRiskService,
    DrawdownRiskService,
    DailyLossLimitService,
    LeverageRiskService,
    // `LeveragePolicyService` decides the effective leverage ceiling from the
    // platform floor, the venue maximum and the tenant policy. It was written
    // with a spec and injected nowhere until `RiskManagementController` gained
    // the route that reads it; without this line the API cannot boot, which is
    // what `npm run check:api-di` reports.
    LeveragePolicyService,
    CorrelationRiskService,
    VarRiskService,
    StressTestService,
    RiskManagementSnapshotRepository,
    RiskEventService,
    CircuitBreakerService,
    KillSwitchOrchestratorService,
    RiskDecisionService,
    RiskReconciliationService,
    // The one implementation of the user position/open-order ceiling. Provided here and
    // exported so the order path reserves through the same service the settings route
    // writes to - a second instance would mean two locks for one policy.
    PositionLimitService,
    // Owner-scoped customer exposure. It was implemented and unit-tested and in no module, so the
    // two routes below had nothing to inject.
    CustomerExposureService,
  ],
  exports: [
    InstitutionalRiskPolicyService,
    PortfolioExposureService,
    PositionRiskService,
    OrderRiskService,
    MarginRiskService,
    LiquidationRiskService,
    ConcentrationRiskService,
    DrawdownRiskService,
    DailyLossLimitService,
    LeverageRiskService,
    CorrelationRiskService,
    VarRiskService,
    StressTestService,
    RiskManagementSnapshotRepository,
    RiskEventService,
    CircuitBreakerService,
    KillSwitchOrchestratorService,
    RiskDecisionService,
    RiskReconciliationService,
    PositionLimitService,
    CustomerExposureService,
  ],
})
export class RiskManagementModule {}
