import { Module, forwardRef } from '@nestjs/common';
import { OmsController } from './oms.controller';
import { OrderIntentService } from './order-intent.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderRoutingService } from './order-routing.service';
import { ExecutionAckService } from './execution-ack.service';
import { FillManagementService } from './fill-management.service';
import { TradeLifecycleService } from './trade-lifecycle.service';
import { OrderCancelService } from './order-cancel.service';
import { OrderReplaceService } from './order-replace.service';
import { AllocationService } from './allocation.service';
import { ExecutionQualityService } from './execution-quality.service';
import { ExecutionLatencyService } from './execution-latency.service';
import { VenueExecutionScoreService } from './venue-execution-score.service';
import { OrderRejectionService } from './order-rejection.service';
import { OrderReconciliationService } from './order-reconciliation.service';
import { FillReconciliationService } from './fill-reconciliation.service';
import { PositionReconciliationService } from './position-reconciliation.service';
import { PostTradeService } from './post-trade.service';
import { TradeOperationsService } from './trade-operations.service';
import { OmsAuditService } from './oms-audit.service';

// Existing modules integration
import { ExecutionModule } from '../execution/execution.module';
import { ExchangesModule } from '../exchanges/exchanges.module';
import { RiskManagementModule } from '../risk-management/risk-management.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { SecurityModule } from '../security/security.module';
import { CopyTradingModule } from '../copy-trading/copy-trading.module';
import { ResearchModule } from '../research/research.module';
import { BillingModule } from '../billing/billing.module';

/**
 * Part 17 — Institutional OMS Module
 *
 * NestJS wiring for OMS services, repositories/dependencies, controller,
 * existing execution engine, exchange, risk, compliance, fees, usage, notifications, audit.
 *
 * Architecture:
 * Order Intent → Risk → Compliance → Exchange Routing → Live Gate → Existing Execution Engine
 * → Exchange ACK → Exchange Order → Fills → Trade Lifecycle → Position Reconciliation → Post-Trade
 * → Fees → Usage → Notifications → Execution Analytics → Operational Reconciliation
 *
 * Correct: OMS Intent → Existing Risk → Existing Compliance → Existing Exchange Routing → Existing Live Gate → Existing Execution Engine → Exchange
 * Incorrect: OMS → direct Binance/Bybit REST call
 */

@Module({
  imports: [
    forwardRef(() => ExecutionModule),
    forwardRef(() => ExchangesModule),
    forwardRef(() => RiskManagementModule),
    forwardRef(() => ComplianceModule),
    forwardRef(() => SecurityModule),
    forwardRef(() => CopyTradingModule),
    forwardRef(() => ResearchModule),
    forwardRef(() => BillingModule),
  ],
  controllers: [OmsController],
  providers: [
    OrderIntentService,
    OrderLifecycleService,
    OrderRoutingService,
    ExecutionAckService,
    FillManagementService,
    TradeLifecycleService,
    OrderCancelService,
    OrderReplaceService,
    AllocationService,
    ExecutionQualityService,
    ExecutionLatencyService,
    VenueExecutionScoreService,
    OrderRejectionService,
    OrderReconciliationService,
    FillReconciliationService,
    PositionReconciliationService,
    PostTradeService,
    TradeOperationsService,
    OmsAuditService,
  ],
  exports: [
    OrderIntentService,
    OrderLifecycleService,
    OrderRoutingService,
    ExecutionAckService,
    FillManagementService,
    TradeLifecycleService,
    OrderCancelService,
    OrderReplaceService,
    AllocationService,
    ExecutionQualityService,
    ExecutionLatencyService,
    VenueExecutionScoreService,
    OrderRejectionService,
    OrderReconciliationService,
    FillReconciliationService,
    PositionReconciliationService,
    PostTradeService,
    TradeOperationsService,
    OmsAuditService,
  ],
})
export class OmsModule {}
