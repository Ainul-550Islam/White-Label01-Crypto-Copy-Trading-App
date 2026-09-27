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
import { CorrelationRiskService } from './correlation-risk.service';
import { VarRiskService } from './var-risk.service';
import { StressTestService } from './stress-test.service';
import { RiskManagementSnapshotRepository } from './risk-snapshot.repository';
import { RiskEventService } from './risk-event.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { KillSwitchOrchestratorService } from './kill-switch-orchestrator.service';
import { RiskDecisionService } from './risk-decision.service';
import { RiskReconciliationService } from './risk-reconciliation.service';

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
  controllers: [RiskManagementController],
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
    CorrelationRiskService,
    VarRiskService,
    StressTestService,
    RiskManagementSnapshotRepository,
    RiskEventService,
    CircuitBreakerService,
    KillSwitchOrchestratorService,
    RiskDecisionService,
    RiskReconciliationService,
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
  ],
})
export class RiskManagementModule {}
