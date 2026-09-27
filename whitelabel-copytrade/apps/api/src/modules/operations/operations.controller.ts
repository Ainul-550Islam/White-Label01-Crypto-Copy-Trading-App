import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { SystemReadinessService } from './system-readiness.service';
import { DependencyHealthService } from './dependency-health.service';
import { QueueHealthService } from './queue-health.service';
import { JobHealthService } from './job-health.service';
import { ReconciliationOrchestratorService } from './reconciliation-orchestrator.service';
import { ReconciliationScheduleService } from './reconciliation-schedule.service';
import { IncidentService } from './incident.service';
import { IncidentEscalationService } from './incident-escalation.service';
import { MaintenanceWindowService } from './maintenance-window.service';
import { MaintenanceModeService } from './maintenance-mode.service';
import { ServiceDegradationService } from './service-degradation.service';
import { RecoveryPlanService } from './recovery-plan.service';
import { OperatorActionService } from './operator-action.service';
import { RunbookService } from './runbook.service';
import { OperationalAuditService } from './operational-audit.service';
import { OperationalMetricsService } from './operational-metrics.service';
import { OperationsPolicyService } from './operations-policy.service';

import {
  CreateIncidentDto,
  AcknowledgeIncidentDto,
  ResolveIncidentDto,
  SuppressIncidentDto,
  ReopenIncidentDto,
  EscalateIncidentDto,
  AssignIncidentDto,
  OperatorActionDto,
  RecoveryActionDto,
  ExecuteRecoveryDto,
} from './dto/incident-action.dto';
import {
  CreateMaintenanceWindowDto,
  CancelMaintenanceWindowDto,
  EnterMaintenanceDto,
  ExitMaintenanceDto,
  SetDegradationDto,
  ClearDegradationDto,
} from './dto/maintenance-window.dto';
import {
  IncidentQueryDto,
  DependencyQueryDto,
  ReconciliationQueryDto,
  MaintenanceQueryDto,
  RecoveryQueryDto,
  ActionQueryDto,
  DegradationQueryDto,
  AuditQueryDto,
  MetricsQueryDto,
  ReadinessQueryDto,
} from './dto/operations-query.dto';
import {
  TriggerReadinessCheckDto,
  TriggerDependencyCheckDto,
  TriggerReconciliationDto,
  TriggerQueueCheckDto,
  TriggerJobCheckDto,
  RequestRecoveryDto,
  ApproveRecoveryDto,
  OperatorDiagnosticDto,
} from './dto/readiness-action.dto';

import { OperationalMaintenanceScope } from './operations.types';

/**
 * Tenant-safe and platform-safe API controller exposing operational status, readiness,
 * dependencies, incidents, reconciliation runs, maintenance windows, metrics, recovery,
 * and operator actions. Enforce existing RBAC/security policies and never expose secrets.
 */

@Controller('operations')
export class OperationsController {
  constructor(
    private readonly readinessService: SystemReadinessService,
    private readonly dependencyHealthService: DependencyHealthService,
    private readonly queueHealthService: QueueHealthService,
    private readonly jobHealthService: JobHealthService,
    private readonly reconciliationOrchestrator: ReconciliationOrchestratorService,
    private readonly reconciliationSchedule: ReconciliationScheduleService,
    private readonly incidentService: IncidentService,
    private readonly escalationService: IncidentEscalationService,
    private readonly maintenanceWindowService: MaintenanceWindowService,
    private readonly maintenanceModeService: MaintenanceModeService,
    private readonly degradationService: ServiceDegradationService,
    private readonly recoveryPlanService: RecoveryPlanService,
    private readonly operatorActionService: OperatorActionService,
    private readonly runbookService: RunbookService,
    private readonly auditService: OperationalAuditService,
    private readonly metricsService: OperationalMetricsService,
    private readonly policyService: OperationsPolicyService,
  ) {}

  private getTenantIdFromRequest(req: any): string | null {
    // Tenant resolution via existing middleware — tenantId in request
    const tenantId = req?.user?.tenantId ?? req?.tenantId ?? req?.headers?.['x-tenant-id'] ?? null;
    return tenantId;
  }

  private getActorIdFromRequest(req: any): string | null {
    return req?.user?.id ?? req?.user?.userId ?? null;
  }

  private isPlatformUser(req: any): boolean {
    // Platform RBAC check — reuse existing RBAC model
    const roles = req?.user?.roles ?? [];
    const isPlatform = req?.user?.isPlatformUser ?? false;
    const hasPlatformRole = roles.some((r: any) => {
      const key = typeof r === 'string' ? r : r.key ?? r.role?.key ?? '';
      return key.toLowerCase().includes('platform') || key.toLowerCase().includes('admin');
    });
    return isPlatform || hasPlatformRole;
  }

  private enforceTenantIsolation(requestedTenantId: string | null, req: any): void {
    const userTenantId = this.getTenantIdFromRequest(req);
    const isPlatform = this.isPlatformUser(req);
    if (isPlatform) return; // platform can access all with RBAC
    if (userTenantId && requestedTenantId && userTenantId !== requestedTenantId) {
      throw new ForbiddenException('Tenant isolation violation');
    }
    if (!isPlatform && !userTenantId && requestedTenantId) {
      // Non-platform user without tenant trying to access tenant data
      throw new ForbiddenException('Tenant context required');
    }
  }

  private enforcePlatformRBAC(req: any): void {
    if (!this.isPlatformUser(req)) {
      throw new ForbiddenException('Platform operation requires platform RBAC');
    }
  }

  // --- Readiness ---

  @Get('readiness')
  async getReadiness(@Query() query: ReadinessQueryDto, @Req() req: any) {
    const tenantId = query.tenantId ?? this.getTenantIdFromRequest(req);
    this.enforceTenantIsolation(tenantId ?? null, req);
    // If tenantId null and not platform user, forbid platform visibility
    if (tenantId === null && !this.isPlatformUser(req)) {
      // Allow tenant to check own readiness via inferred tenantId
      const inferred = this.getTenantIdFromRequest(req);
      if (!inferred) throw new ForbiddenException('Platform readiness requires platform RBAC');
      return this.readinessService.evaluate({ tenantId: inferred, correlationId: null });
    }
    return this.readinessService.evaluate({ tenantId: tenantId ?? null, correlationId: null });
  }

  @Post('readiness/check')
  async triggerReadinessCheck(@Body() dto: TriggerReadinessCheckDto, @Req() req: any) {
    const tenantId = dto.tenantId ?? this.getTenantIdFromRequest(req);
    this.enforceTenantIsolation(tenantId ?? null, req);
    if (tenantId === null && !this.isPlatformUser(req)) throw new ForbiddenException('Platform readiness check requires platform RBAC');
    const actorId = this.getActorIdFromRequest(req);
    return this.readinessService.evaluate({ tenantId: tenantId ?? null, requestedBy: actorId, correlationId: dto.correlationId ?? null });
  }

  @Get('readiness/latest')
  async getLatestReadiness(@Query() query: ReadinessQueryDto, @Req() req: any) {
    const tenantId = query.tenantId ?? this.getTenantIdFromRequest(req);
    this.enforceTenantIsolation(tenantId ?? null, req);
    return this.readinessService.getLatest(tenantId ?? null);
  }

  // --- Dependencies ---

  @Get('dependencies')
  async getDependencies(@Query() query: DependencyQueryDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    // Platform-only operations remain protected — but dependency health can be tenant-scoped
    const results = await this.dependencyHealthService.checkAll(tenantId);
    return { data: results, total: results.length };
  }

  @Post('dependencies/check')
  async triggerDependencyCheck(@Body() dto: TriggerDependencyCheckDto, @Req() req: any) {
    const tenantId = dto.tenantId ?? this.getTenantIdFromRequest(req);
    this.enforceTenantIsolation(tenantId ?? null, req);
    const results = await this.dependencyHealthService.checkAll(tenantId ?? null);
    return { data: results, total: results.length };
  }

  // --- Queues ---

  @Get('queues/health')
  async getQueueHealth(@Req() req: any) {
    // Platform operation — but allow tenant to see own queue health if needed
    const results = await this.queueHealthService.evaluate();
    return { data: results, total: results.length };
  }

  @Post('queues/check')
  async triggerQueueCheck(@Body() dto: TriggerQueueCheckDto, @Req() req: any) {
    const results = await this.queueHealthService.evaluate();
    if (dto.queueName) {
      const filtered = results.filter((r) => r.queueName === dto.queueName);
      return { data: filtered, total: filtered.length };
    }
    return { data: results, total: results.length };
  }

  // --- Jobs ---

  @Get('jobs/health')
  async getJobHealth(@Req() req: any) {
    const results = await this.jobHealthService.evaluate();
    return { data: results, total: results.length };
  }

  @Post('jobs/check')
  async triggerJobCheck(@Body() dto: TriggerJobCheckDto, @Req() req: any) {
    const results = await this.jobHealthService.evaluate();
    if (dto.jobName) {
      const filtered = results.filter((r) => r.jobName === dto.jobName);
      return { data: filtered, total: filtered.length };
    }
    return { data: results, total: results.length };
  }

  // --- Incidents ---

  @Get('incidents')
  async listIncidents(@Query() query: IncidentQueryDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const isPlatform = this.isPlatformUser(req);
    // Tenant isolation: tenant cannot read another tenant's incidents
    const effectiveTenantId = isPlatform ? (query as any).tenantId ?? null : tenantId;
    if (!isPlatform && tenantId === null) throw new ForbiddenException('Tenant context required');
    return this.incidentService.listIncidents({
      tenantId: effectiveTenantId ?? null,
      state: query.state,
      severity: query.severity,
      type: query.type,
      affectedComponent: query.affectedComponent,
      correlationId: query.correlationId,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('incidents/:id')
  async getIncident(@Param('id') id: string, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const isPlatform = this.isPlatformUser(req);
    const effectiveTenantId = isPlatform ? null : tenantId;
    // For platform user with null tenantId, we allow reading any incident, but for tenant we enforce isolation inside service
    return this.incidentService.getIncident(effectiveTenantId ?? null, id);
  }

  @Post('incidents')
  async createIncident(@Body() dto: CreateIncidentDto, @Req() req: any) {
    const actorId = this.getActorIdFromRequest(req);
    const tenantId = dto.tenantId ?? this.getTenantIdFromRequest(req);
    this.enforceTenantIsolation(tenantId ?? null, req);
    // Platform incidents require platform RBAC
    if (tenantId === null && !this.isPlatformUser(req)) throw new ForbiddenException('Platform incident creation requires platform RBAC');
    return this.incidentService.createIncident({
      tenantId: tenantId ?? null,
      type: dto.type,
      severity: dto.severity,
      title: dto.title,
      summary: dto.summary,
      source: dto.source,
      affectedComponent: dto.affectedComponent,
      affectedCapability: dto.affectedCapability ?? null,
      scopeTarget: dto.scopeTarget ?? null,
      evidence: dto.evidence ?? {},
      correlationId: dto.correlationId ?? null,
      requestId: dto.requestId ?? null,
      actorId: actorId ?? null,
    });
  }

  @Post('incidents/:id/acknowledge')
  async acknowledgeIncident(@Param('id') id: string, @Body() dto: AcknowledgeIncidentDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const actorId = this.getActorIdFromRequest(req);
    return this.incidentService.acknowledge({
      tenantId: tenantId ?? null,
      incidentId: id,
      actorId: actorId ?? null,
      reason: dto.reason ?? null,
      correlationId: dto.correlationId ?? null,
      requestId: dto.requestId ?? null,
    });
  }

  @Post('incidents/:id/resolve')
  async resolveIncident(@Param('id') id: string, @Body() dto: ResolveIncidentDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const actorId = this.getActorIdFromRequest(req);
    return this.incidentService.resolve({
      tenantId: tenantId ?? null,
      incidentId: id,
      actorId: actorId ?? null,
      reason: dto.reason,
      correlationId: dto.correlationId ?? null,
      requestId: dto.requestId ?? null,
    });
  }

  @Post('incidents/:id/suppress')
  async suppressIncident(@Param('id') id: string, @Body() dto: SuppressIncidentDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const actorId = this.getActorIdFromRequest(req);
    return this.incidentService.suppress({
      tenantId: tenantId ?? null,
      incidentId: id,
      actorId: actorId ?? null,
      reason: dto.reason,
      suppressUntil: dto.suppressUntil ? new Date(dto.suppressUntil) : null,
      correlationId: dto.correlationId ?? null,
      requestId: dto.requestId ?? null,
    });
  }

  @Post('incidents/:id/reopen')
  async reopenIncident(@Param('id') id: string, @Body() dto: ReopenIncidentDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const actorId = this.getActorIdFromRequest(req);
    return this.incidentService.reopen({
      tenantId: tenantId ?? null,
      incidentId: id,
      actorId: actorId ?? null,
      reason: dto.reason,
      correlationId: dto.correlationId ?? null,
      requestId: dto.requestId ?? null,
    });
  }

  @Post('incidents/:id/escalate')
  async escalateIncident(@Param('id') id: string, @Body() dto: EscalateIncidentDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const actorId = this.getActorIdFromRequest(req);
    return this.escalationService.evaluateAndEscalate({
      tenantId: tenantId ?? null,
      incidentId: id,
      triggeredBy: actorId ?? null,
      correlationId: dto.correlationId ?? null,
    });
  }

  @Post('incidents/:id/assign')
  async assignIncident(@Param('id') id: string, @Body() dto: AssignIncidentDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const actorId = this.getActorIdFromRequest(req);
    return this.incidentService.assignOperator({
      tenantId: tenantId ?? null,
      incidentId: id,
      operatorId: dto.operatorId,
      actorId: actorId ?? null,
    });
  }

  // --- Reconciliation ---

  @Get('reconciliations')
  async listReconciliations(@Query() query: ReconciliationQueryDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const isPlatform = this.isPlatformUser(req);
    const effectiveTenantId = isPlatform ? (query as any).tenantId ?? null : tenantId;
    return this.reconciliationOrchestrator.listRuns({
      tenantId: effectiveTenantId ?? null,
      type: query.type,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('reconciliations/:id')
  async getReconciliation(@Param('id') id: string, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    return this.reconciliationOrchestrator.getRun(tenantId ?? null, id);
  }

  @Post('reconciliations/trigger')
  async triggerReconciliation(@Body() dto: TriggerReconciliationDto, @Req() req: any) {
    const tenantId = dto.tenantId ?? this.getTenantIdFromRequest(req);
    this.enforceTenantIsolation(tenantId ?? null, req);
    const actorId = this.getActorIdFromRequest(req);
    return this.reconciliationOrchestrator.runReconciliation({
      tenantId: tenantId ?? null,
      type: dto.type,
      requestedBy: actorId ?? null,
      triggerType: 'MANUAL' as any,
      correlationId: dto.correlationId ?? null,
    });
  }

  @Get('reconciliations/schedules')
  async getReconciliationSchedules(@Req() req: any) {
    this.enforcePlatformRBAC(req);
    return { data: this.reconciliationSchedule.getSchedules() };
  }

  @Post('reconciliations/schedule/all')
  async scheduleAllReconciliations(@Req() req: any) {
    this.enforcePlatformRBAC(req);
    await this.reconciliationSchedule.scheduleAll();
    return { scheduled: true };
  }

  // --- Maintenance ---

  @Get('maintenance')
  async listMaintenance(@Query() query: MaintenanceQueryDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const isPlatform = this.isPlatformUser(req);
    const effectiveTenantId = isPlatform ? (query as any).tenantId ?? null : tenantId;
    return this.maintenanceWindowService.listWindows({
      tenantId: effectiveTenantId ?? null,
      scope: query.scope,
      state: query.state,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('maintenance/:id')
  async getMaintenance(@Param('id') id: string, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    return this.maintenanceWindowService.getWindow(tenantId ?? null, id);
  }

  @Post('maintenance')
  async createMaintenance(@Body() dto: CreateMaintenanceWindowDto, @Req() req: any) {
    const tenantId = dto.tenantId ?? this.getTenantIdFromRequest(req);
    this.enforceTenantIsolation(tenantId ?? null, req);
    // Maintenance authorization: platform scopes require platform role
    if (dto.scope === OperationalMaintenanceScope.PLATFORM && !this.isPlatformUser(req)) {
      throw new ForbiddenException('Platform maintenance requires platform RBAC');
    }
    const actorId = this.getActorIdFromRequest(req);
    return this.maintenanceWindowService.createWindow({
      tenantId: tenantId ?? null,
      scope: dto.scope,
      scopeTarget: dto.scopeTarget ?? null,
      title: dto.title,
      description: dto.description ?? null,
      scheduledStart: dto.scheduledStart,
      scheduledEnd: dto.scheduledEnd,
      requestedBy: actorId ?? null,
      correlationId: dto.correlationId ?? null,
      isEmergency: dto.isEmergency ?? false,
    });
  }

  @Post('maintenance/:id/cancel')
  async cancelMaintenance(@Param('id') id: string, @Body() dto: CancelMaintenanceWindowDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const actorId = this.getActorIdFromRequest(req);
    return this.maintenanceWindowService.cancelWindow({
      tenantId: tenantId ?? null,
      windowId: id,
      actorId: actorId ?? null,
      reason: dto.reason,
      correlationId: dto.correlationId ?? null,
    });
  }

  @Post('maintenance/enter')
  async enterMaintenance(@Body() dto: EnterMaintenanceDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    // Maintenance does not bypass live gate — enforced inside service, but also check here
    if (dto.scope === OperationalMaintenanceScope.PLATFORM && !this.isPlatformUser(req)) {
      throw new ForbiddenException('Platform maintenance requires platform RBAC');
    }
    const actorId = this.getActorIdFromRequest(req);
    return this.maintenanceModeService.enterMaintenance({
      tenantId: tenantId ?? null,
      scope: dto.scope,
      scopeTarget: dto.scopeTarget ?? null,
      title: dto.title,
      description: dto.description ?? null,
      scheduledStart: dto.scheduledStart ? new Date(dto.scheduledStart) : new Date(),
      scheduledEnd: dto.scheduledEnd ? new Date(dto.scheduledEnd) : new Date(Date.now() + 60 * 60 * 1000),
      requestedBy: actorId ?? null,
      correlationId: dto.correlationId ?? null,
      isEmergency: dto.isEmergency ?? false,
    });
  }

  @Post('maintenance/exit')
  async exitMaintenance(@Body() dto: ExitMaintenanceDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const actorId = this.getActorIdFromRequest(req);
    return this.maintenanceModeService.exitMaintenance({
      tenantId: tenantId ?? null,
      scope: dto.scope ?? 'SERVICE' as any,
      scopeTarget: dto.scopeTarget ?? null,
      windowId: dto.windowId ?? null,
      requestedBy: actorId ?? null,
      correlationId: dto.correlationId ?? null,
    });
  }

  // --- Degradation ---

  @Get('degradations')
  async listDegradations(@Query() query: DegradationQueryDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const isPlatform = this.isPlatformUser(req);
    const effectiveTenantId = isPlatform ? (query as any).tenantId ?? null : tenantId;
    return this.degradationService.listDegradations({
      tenantId: effectiveTenantId ?? null,
      serviceName: query.serviceName,
      level: query.level,
      page: query.page,
      limit: query.limit,
    });
  }

  @Post('degradations')
  async setDegradation(@Body() dto: SetDegradationDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const actorId = this.getActorIdFromRequest(req);
    // Degradation state restrictions — platform service degradation requires platform RBAC
    if (!this.isPlatformUser(req) && !tenantId) {
      throw new ForbiddenException('Degradation change requires tenant context or platform RBAC');
    }
    return this.degradationService.setDegradation({
      tenantId: tenantId ?? null,
      serviceName: dto.serviceName,
      capability: dto.capability ?? null,
      level: dto.level,
      reason: dto.reason,
      requestedBy: actorId ?? null,
      correlationId: dto.correlationId ?? null,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date(),
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
    });
  }

  @Post('degradations/clear')
  async clearDegradation(@Body() dto: ClearDegradationDto & { serviceName: string }, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const actorId = this.getActorIdFromRequest(req);
    return this.degradationService.clearDegradation({
      tenantId: tenantId ?? null,
      serviceName: dto.serviceName,
      capability: dto.capability ?? null,
      actorId: actorId ?? null,
      correlationId: dto.correlationId ?? null,
    });
  }

  // --- Recovery ---

  @Get('recovery/plans')
  async getRecoveryPlans(@Req() req: any) {
    return { data: this.recoveryPlanService.getPlans() };
  }

  @Get('recovery/runs')
  async listRecoveryRuns(@Query() query: RecoveryQueryDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const isPlatform = this.isPlatformUser(req);
    const effectiveTenantId = isPlatform ? (query as any).tenantId ?? null : tenantId;
    return this.recoveryPlanService.listRecoveryRuns({
      tenantId: effectiveTenantId ?? null,
      planId: query.planId,
      state: query.state,
      incidentId: query.incidentId,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('recovery/runs/:id')
  async getRecoveryRun(@Param('id') id: string, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    return this.recoveryPlanService.getRecoveryRun(tenantId ?? null, id);
  }

  @Post('recovery/request')
  async requestRecovery(@Body() dto: RequestRecoveryDto, @Req() req: any) {
    const tenantId = dto.tenantId ?? this.getTenantIdFromRequest(req);
    this.enforceTenantIsolation(tenantId ?? null, req);
    const actorId = this.getActorIdFromRequest(req);
    // Recovery requires authorization
    if (!actorId) throw new ForbiddenException('Recovery requires authentication');
    return this.recoveryPlanService.createRecoveryRun({
      tenantId: tenantId ?? null,
      planId: dto.planId,
      incidentId: dto.incidentId ?? null,
      maintenanceWindowId: dto.maintenanceWindowId ?? null,
      requestedBy: actorId ?? null,
      correlationId: dto.correlationId ?? null,
    });
  }

  @Post('recovery/runs/:id/approve')
  async approveRecovery(@Param('id') id: string, @Body() dto: ApproveRecoveryDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const actorId = this.getActorIdFromRequest(req);
    if (!actorId) throw new ForbiddenException('Approval requires authentication');
    this.enforcePlatformRBAC(req); // Recovery approval requires platform or elevated role
    return this.recoveryPlanService.approveRecoveryRun({
      tenantId: tenantId ?? null,
      recoveryRunId: id,
      approvedBy: actorId,
      correlationId: dto.correlationId ?? null,
    });
  }

  @Post('recovery/runs/:id/execute')
  async executeRecovery(@Param('id') id: string, @Body() dto: ExecuteRecoveryDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const actorId = this.getActorIdFromRequest(req);
    if (!actorId) throw new ForbiddenException('Execution requires authentication');
    // Recovery cannot bypass risk/compliance/OMS/execution — enforced in recovery service
    return this.recoveryPlanService.executeRecoveryRun({
      tenantId: tenantId ?? null,
      recoveryRunId: id,
      actorId: actorId ?? null,
      correlationId: dto.correlationId ?? null,
    });
  }

  // --- Operator Actions ---

  @Post('actions')
  async executeOperatorAction(@Body() dto: OperatorActionDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const actorId = this.getActorIdFromRequest(req);
    if (!actorId) throw new ForbiddenException('Operator action requires authentication');
    return this.operatorActionService.executeAction({
      tenantId: tenantId ?? null,
      actionType: dto.actionType,
      targetType: dto.targetType ?? null,
      targetId: dto.targetId ?? null,
      actorId: actorId ?? null,
      reason: dto.reason ?? null,
      preconditions: dto.preconditions ?? {},
      payload: dto.payload ?? {},
      correlationId: dto.correlationId ?? null,
      requestId: dto.requestId ?? null,
    });
  }

  @Get('actions')
  async listActions(@Query() query: ActionQueryDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const isPlatform = this.isPlatformUser(req);
    const effectiveTenantId = isPlatform ? (query as any).tenantId ?? null : tenantId;
    return this.operatorActionService.listActions({
      tenantId: effectiveTenantId ?? null,
      actionType: query.actionType,
      status: query.status,
      targetType: query.targetType,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('actions/:id')
  async getAction(@Param('id') id: string, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    return this.operatorActionService.getAction(tenantId ?? null, id);
  }

  // --- Runbooks ---

  @Get('runbooks')
  async getRunbooks(@Req() req: any) {
    return { data: this.runbookService.getRunbooks() };
  }

  @Get('runbooks/:id')
  async getRunbook(@Param('id') id: string, @Req() req: any) {
    const rb = this.runbookService.getRunbook(id);
    if (!rb) throw new BadRequestException(`Runbook ${id} not found`);
    return rb;
  }

  // --- Audit ---

  @Get('audit')
  async listAudit(@Query() query: AuditQueryDto, @Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    const isPlatform = this.isPlatformUser(req);
    const effectiveTenantId = isPlatform ? (query as any).tenantId ?? null : tenantId;
    // Tenant cannot read another tenant's audit records
    return this.auditService.list({
      tenantId: effectiveTenantId ?? null,
      eventType: query.eventType,
      targetType: query.targetType,
      targetId: query.targetId,
      correlationId: query.correlationId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  // --- Metrics ---

  @Get('metrics')
  async getMetrics(@Query() query: MetricsQueryDto, @Req() req: any) {
    const tenantId = query.tenantId ?? this.getTenantIdFromRequest(req);
    this.enforceTenantIsolation(tenantId ?? null, req);
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = query.to ? new Date(query.to) : new Date();
    return this.metricsService.calculateMetrics({ tenantId: tenantId ?? null, from, to });
  }

  @Get('metrics/current')
  async getCurrentMetrics(@Req() req: any) {
    const tenantId = this.getTenantIdFromRequest(req);
    return this.metricsService.getCurrentMetrics(tenantId ?? null);
  }

  // --- Diagnostics ---

  @Post('diagnostics')
  async runDiagnostics(@Body() dto: OperatorDiagnosticDto, @Req() req: any) {
    const tenantId = dto.tenantId ?? this.getTenantIdFromRequest(req);
    this.enforceTenantIsolation(tenantId ?? null, req);
    const actorId = this.getActorIdFromRequest(req);

    // Gather diagnostics without mutating state
    const readiness = await this.readinessService.evaluate({ tenantId: tenantId ?? null, requestedBy: actorId ?? null, correlationId: dto.correlationId ?? null }).catch(() => null);
    const dependencies = await this.dependencyHealthService.checkAll(tenantId ?? null).catch(() => []);
    const queues = await this.queueHealthService.evaluate().catch(() => []);
    const jobs = await this.jobHealthService.evaluate().catch(() => []);

    await this.auditService.record({
      tenantId: tenantId ?? null,
      eventType: 'OPERATOR_ACTION' as any,
      actorId: actorId ?? null,
      actorType: actorId ? 'USER' : 'SYSTEM',
      targetType: 'DIAGNOSTIC',
      targetId: dto.component ?? 'all',
      evidence: { component: dto.component ?? 'all', correlationId: dto.correlationId },
      correlationId: dto.correlationId ?? null,
    });

    return {
      readiness,
      dependencies,
      queues,
      jobs,
      runbook: dto.component ? this.runbookService.getRunbookByFailureClass(dto.component) : null,
      correlationId: dto.correlationId ?? null,
      checkedAt: new Date().toISOString(),
    };
  }
}
