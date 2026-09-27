import { Module, forwardRef } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { OperationsPolicyService } from './operations-policy.service';
import { SystemReadinessService } from './system-readiness.service';
import { DependencyHealthService } from './dependency-health.service';
import { QueueHealthService } from './queue-health.service';
import { JobHealthService } from './job-health.service';
import { ReconciliationOrchestratorService } from './reconciliation-orchestrator.service';
import { ReconciliationScheduleService } from './reconciliation-schedule.service';
import { IncidentService } from './incident.service';
import { IncidentDeduplicationService } from './incident-deduplication.service';
import { IncidentEscalationService } from './incident-escalation.service';
import { MaintenanceWindowService } from './maintenance-window.service';
import { MaintenanceModeService } from './maintenance-mode.service';
import { ServiceDegradationService } from './service-degradation.service';
import { RecoveryPlanService } from './recovery-plan.service';
import { OperatorActionService } from './operator-action.service';
import { RunbookService } from './runbook.service';
import { OperationalAuditService } from './operational-audit.service';
import { OperationalMetricsService } from './operational-metrics.service';

// Existing modules integration — forwardRef only where actually required
import { ExecutionModule } from '../execution/execution.module';
import { ExchangesModule } from '../exchanges/exchanges.module';
import { RiskManagementModule } from '../risk-management/risk-management.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { SecurityModule } from '../security/security.module';
import { CopyTradingModule } from '../copy-trading/copy-trading.module';
import { ResearchModule } from '../research/research.module';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OmsModule } from '../oms/oms.module';
import { QueueModule } from '../queue/queue.module';
import { AuditModule } from '../audit/audit.module';

/**
 * Part 18 — Institutional Operations, Reliability & Incident Control Plane
 *
 * Wires the complete Operations module with Prisma, Redis, queues, scheduler, audit,
 * security, notifications, OMS, exchanges, risk management, compliance, copy-trading,
 * research, billing/finance, usage, subscriptions, live-gate, execution safety,
 * and existing infrastructure using forwardRef only where actually required.
 *
 * Final operational chain:
 * Infrastructure + Application Dependencies
 *   ↓ Dependency Health
 *   ↓ System Readiness
 *   ↓ Queue / Job Health
 *   ↓ Operational Policies
 *   ↓ Reconciliation Orchestrator
 *   ↓ Incident Detection / Deduplication
 *   ↓ Severity + Escalation
 *   ↓ Maintenance / Controlled Degradation
 *   ↓ Operator Action
 *   ↓ Recovery Plan / Runbook
 *   ↓ Reconciliation Verification
 *   ↓ Operational Metrics
 *   ↓ Immutable Operational Audit
 *
 * Safety: NEVER mark order FILLED, mark exchange HEALTHY without evidence, approve risk,
 * clear compliance block, activate LIVE, replace exchange truth, rewrite positions, invent fills,
 * invent payment success, invent invoice settlement, invent usage, invent reconciliation success,
 * bypass locks, credential controls, venue attestation, IP allowlist, signed transport, OMS, execution engine.
 * Recovery always re-enters existing authoritative service boundary.
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
    forwardRef(() => NotificationsModule),
    forwardRef(() => OmsModule),
    forwardRef(() => QueueModule),
    forwardRef(() => AuditModule),
  ],
  controllers: [OperationsController],
  providers: [
    OperationsPolicyService,
    SystemReadinessService,
    DependencyHealthService,
    QueueHealthService,
    JobHealthService,
    ReconciliationOrchestratorService,
    ReconciliationScheduleService,
    IncidentService,
    IncidentDeduplicationService,
    IncidentEscalationService,
    MaintenanceWindowService,
    MaintenanceModeService,
    ServiceDegradationService,
    RecoveryPlanService,
    OperatorActionService,
    RunbookService,
    OperationalAuditService,
    OperationalMetricsService,
  ],
  exports: [
    OperationsPolicyService,
    SystemReadinessService,
    DependencyHealthService,
    QueueHealthService,
    JobHealthService,
    ReconciliationOrchestratorService,
    ReconciliationScheduleService,
    IncidentService,
    IncidentDeduplicationService,
    IncidentEscalationService,
    MaintenanceWindowService,
    MaintenanceModeService,
    ServiceDegradationService,
    RecoveryPlanService,
    OperatorActionService,
    RunbookService,
    OperationalAuditService,
    OperationalMetricsService,
  ],
})
export class OperationsModule {}
