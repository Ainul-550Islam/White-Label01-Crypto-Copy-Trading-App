// # Responsibility: preserve permission/tenant guards while binding audit/reviewer identity to the verified actor, validating query membership, and checking report/delivery route coherence.
import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';
import type { Request } from 'express';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { requireMutationKey } from '../developer-platform/developer-mutation-intent';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrivacyRequestState, RetentionState, LegalHoldState, ReportState, GovernanceActionType, type GovernanceReconciliationMismatch } from './governance.types';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { BindTenantParamsGuard } from '../../common/guards/bind-tenant-params.guard';
import { PrivacyRequestService } from './privacy-request.service';
import { PrivacyDiscoveryService } from './privacy-discovery.service';
import { PrivacyExportService } from './privacy-export.service';
import { PrivacyDeletionService } from './privacy-deletion.service';
import { RetentionPolicyService } from './retention-policy.service';
import { RetentionEngineService } from './retention-engine.service';
import { LegalHoldService } from './legal-hold.service';
import { ConsentService } from './consent.service';
import { ComplianceReportService } from './compliance-report.service';
import { ComplianceReportTemplateService } from './compliance-report-template.service';
import { ComplianceReportValidationService } from './compliance-report-validation.service';
import { ComplianceReportCertificationService } from './compliance-report-certification.service';
import { ComplianceReportDeliveryService } from './compliance-report-delivery.service';
import { EvidencePackageService } from './evidence-package.service';
import { GovernanceAuditExportService, type AuditExportFilters } from './governance-audit-export.service';
import { RequireStepUp } from '../auth/step-up/require-step-up.decorator';
import { GovernanceReconciliationService } from './governance-reconciliation.service';
import { GovernanceMetricsService } from './governance-metrics.service';
import { GovernanceReportQueryService } from './governance-report-query.service';
import { DataClassificationService } from './data-classification.service';
import { DataInventoryService } from './data-inventory.service';
import { GovernancePolicyService } from './governance-policy.service';
import {
  CreatePrivacyRequestDto,
  TransitionPrivacyRequestDto,
  CreateLegalHoldDto,
  ActivateLegalHoldDto,
  ReleaseLegalHoldDto,
  CaptureConsentDto,
  WithdrawConsentDto,
  GenerateReportDto,
  ValidateReportDto,
  RequestCertificationDto,
  CertifyReportDto,
  QueueDeliveryDto,
  SubmitDeliveryDto,
  MarkDeliveredDto,
  MarkFailedDto,
  CreateEvidencePackageDto,
  FinalizeEvidencePackageDto,
  AuditExportDto,
  EvaluateRetentionDto,
  ExecuteRetentionActionDto,
  PrivacyDeletionCheckDto,
  PrivacyDeletionExecuteDto,
  ReconciliationDetectDto,
  GovernanceQueryDto,
} from './dto/privacy-request.dto';

const MISMATCH_TYPES: GovernanceReconciliationMismatch['type'][] = ['REPORT_SOURCE_MISSING', 'REPORT_SOURCE_STALE', 'PRIVACY_REQUEST_STUCK',
  'DELETION_BLOCKED_WITHOUT_REASON', 'RETENTION_EXPIRED_WITHOUT_ACTION', 'LEGAL_HOLD_CONFLICT', 'CERTIFICATION_MISSING',
  'DELIVERY_STATUS_UNKNOWN', 'EVIDENCE_INCOMPLETE', 'TENANT_SCOPE_MISMATCH', 'AUDIT_EXPORT_INCOMPLETE'];

/**
 * Privacy, retention, legal holds, consents, regulatory reports and evidence.
 *
 * This controller used to carry no permission metadata and took `tenantId`
 * from the body/query, so any authenticated user of any tenant could run it
 * against any tenant (including executing privacy deletions and releasing
 * legal holds). Now:
 * - BindTenantParamsGuard pins body/query tenantId to the caller's tenant;
 * - reads need compliance:read, writes compliance:write (class default);
 * - destructive or attesting actions need compliance:write + compliance:reviewer.
 */
@RequirePermissions(Permission.COMPLIANCE_WRITE)
@UseGuards(BindTenantParamsGuard)
@Controller('governance')
export class GovernanceController {
  constructor(
    private readonly privacyRequest: PrivacyRequestService,
    private readonly discovery: PrivacyDiscoveryService,
    private readonly privacyExport: PrivacyExportService,
    private readonly privacyDeletion: PrivacyDeletionService,
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly retentionEngine: RetentionEngineService,
    private readonly legalHold: LegalHoldService,
    private readonly consent: ConsentService,
    private readonly reportService: ComplianceReportService,
    private readonly templateService: ComplianceReportTemplateService,
    private readonly validationService: ComplianceReportValidationService,
    private readonly certificationService: ComplianceReportCertificationService,
    private readonly deliveryService: ComplianceReportDeliveryService,
    private readonly evidence: EvidencePackageService,
    private readonly auditExport: GovernanceAuditExportService,
    private readonly reconciliation: GovernanceReconciliationService,
    private readonly metrics: GovernanceMetricsService,
    private readonly queryService: GovernanceReportQueryService,
    private readonly classification: DataClassificationService,
    private readonly inventory: DataInventoryService,
    private readonly policyService: GovernancePolicyService,
  ) {}

  // --- Privacy Requests ---
  @Post('privacy-requests')
  async createPrivacyRequest(@Body() dto: CreatePrivacyRequestDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.createdBy);
    return this.privacyRequest.createRequest({
      tenantId: dto.tenantId,
      subjectUserId: dto.subjectUserId,
      subjectType: dto.subjectType,
      requestType: dto.requestType,
      jurisdiction: dto.jurisdiction,
      reason: dto.reason,
      idempotencyKey: dto.idempotencyKey,
      correlationId: dto.correlationId,
      createdBy: actorId,
    });
  }

  @Put('privacy-requests/:id/transition')
  async transitionPrivacyRequest(@Param('id') id: string, @Body() dto: TransitionPrivacyRequestDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.operatorId);
    return this.privacyRequest.transitionRequest({
      tenantId: dto.tenantId,
      requestId: id,
      targetState: dto.targetState,
      correlationId: dto.correlationId,
      operatorId: actorId,
      reason: dto.reason,
      verificationEvidence: dto.verificationEvidence,
    });
  }

  @Get('privacy-requests')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async listPrivacyRequests(@Query() q: GovernanceQueryDto) {
    if (!q.tenantId) throw new BadRequestException('tenantId required');
    return this.queryService.queryPrivacyRequests({
      tenantId: q.tenantId,
      subjectUserId: q.subjectUserId,
      state: this.enumOption(q.state, Object.values(PrivacyRequestState), 'privacy state'),
      correlationId: q.correlationId ?? `corr_${Date.now()}`,
    });
  }

  @Get('privacy-requests/:id')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async getPrivacyRequest(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.privacyRequest.getRequest(tenantId, id);
  }

  @Post('privacy-requests/:id/discover')
  async discoverForRequest(@Param('id') id: string, @Body() body: { tenantId: string; jurisdiction: string; correlationId: string }) {
    if (!body.tenantId) throw new BadRequestException('tenantId required');
    const req = await this.privacyRequest.getRequest(body.tenantId, id);
    return this.discovery.discoverForSubject({
      tenantId: body.tenantId,
      subjectUserId: req.subjectUserId,
      jurisdiction: body.jurisdiction,
      correlationId: body.correlationId,
    });
  }

  @Post('privacy-requests/:id/export')
  async exportForRequest(@Param('id') id: string, @Body() body: { tenantId: string; jurisdiction: string; correlationId: string; operatorId: string }, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(body.tenantId, actor, body.operatorId);
    const req = await this.privacyRequest.getRequest(body.tenantId, id);
    return this.privacyExport.generateExport({
      tenantId: body.tenantId,
      requestId: id,
      subjectUserId: req.subjectUserId,
      jurisdiction: body.jurisdiction,
      correlationId: body.correlationId,
      operatorId: actorId,
    });
  }

  @Post('privacy-requests/:id/deletion-check')
  async checkDeletion(@Param('id') id: string, @Body() dto: PrivacyDeletionCheckDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.operatorId);
    return this.privacyDeletion.checkDeletionEligibility({
      tenantId: dto.tenantId,
      subjectUserId: dto.subjectUserId,
      requestId: id,
      jurisdiction: dto.jurisdiction,
      correlationId: dto.correlationId,
      operatorId: actorId,
    });
  }

  @Post('privacy-requests/:id/deletion-execute')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.COMPLIANCE_REVIEWER)
  async executeDeletion(@Param('id') id: string, @Body() dto: PrivacyDeletionExecuteDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.operatorId);
    return this.privacyDeletion.executeDeletion({
      tenantId: dto.tenantId,
      subjectUserId: dto.subjectUserId,
      requestId: id,
      jurisdiction: dto.jurisdiction,
      correlationId: dto.correlationId,
      operatorId: actorId,
      dryRun: dto.dryRun,
    });
  }

  // --- Retention ---
  @Get('retention/policies')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async getRetentionPolicies(@Query('tenantId') tenantId: string, @Query('jurisdiction') jurisdiction: string) {
    if (!jurisdiction) throw new BadRequestException('jurisdiction required');
    return this.retentionPolicy.getPolicies(tenantId ?? null, jurisdiction);
  }

  @Post('retention/evaluate')
  async evaluateRetention(@Body() dto: EvaluateRetentionDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.operatorId);
    return this.retentionEngine.evaluateCandidate({
      tenantId: dto.tenantId,
      dataClass: dto.dataClass,
      sourceSystem: dto.sourceSystem,
      sourceId: dto.sourceId,
      jurisdiction: dto.jurisdiction,
      retentionStartAt: dto.retentionStartAt,
      correlationId: dto.correlationId,
      operatorId: actorId,
    });
  }

  @Post('retention/:id/action')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.COMPLIANCE_REVIEWER)
  async executeRetentionAction(@Param('id') id: string, @Body() dto: ExecuteRetentionActionDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.operatorId);
    return this.retentionEngine.executeAction({
      tenantId: dto.tenantId,
      candidateId: id,
      action: dto.action,
      correlationId: dto.correlationId,
      operatorId: actorId,
      reason: dto.reason,
    });
  }

  @Get('retention/candidates')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async listRetentionCandidates(@Query() q: GovernanceQueryDto) {
    if (!q.tenantId) throw new BadRequestException('tenantId required');
    return this.retentionEngine.listCandidates(q.tenantId, { state: this.enumOption(q.state, Object.values(RetentionState), 'retention state') });
  }

  // --- Legal Hold ---
  @Post('legal-holds')
  async createLegalHold(@Body() dto: CreateLegalHoldDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.createdBy);
    return this.legalHold.createHold({
      tenantId: dto.tenantId ?? null,
      caseReference: dto.caseReference,
      reason: dto.reason,
      affectedDataClasses: dto.affectedDataClasses,
      affectedJurisdictions: dto.affectedJurisdictions,
      affectedSubjects: dto.affectedSubjects,
      createdBy: actorId,
      correlationId: dto.correlationId,
      expiresAt: dto.expiresAt ?? null,
    });
  }

  @Post('legal-holds/:id/activate')
  async activateLegalHold(@Param('id') id: string, @Body() dto: ActivateLegalHoldDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.activatedBy);
    return this.legalHold.activateHold({
      holdId: id,
      tenantId: dto.tenantId ?? null,
      activatedBy: actorId,
      correlationId: dto.correlationId,
    });
  }

  @Post('legal-holds/:id/release')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.COMPLIANCE_REVIEWER)
  async releaseLegalHold(@Param('id') id: string, @Body() dto: ReleaseLegalHoldDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.releasedBy);
    return this.legalHold.releaseHold({
      holdId: id,
      tenantId: dto.tenantId ?? null,
      releasedBy: actorId,
      correlationId: dto.correlationId,
      reason: dto.reason,
    });
  }

  @Get('legal-holds')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async listLegalHolds(@Query('tenantId') tenantId: string, @Query('state') state: string) {
    return this.legalHold.listHolds(tenantId ?? null, { state: this.enumOption(state, Object.values(LegalHoldState), 'legal-hold state') });
  }

  @Get('legal-holds/active')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async listActiveLegalHolds(@Query('tenantId') tenantId: string) {
    return this.legalHold.listActiveHolds(tenantId ?? null);
  }

  // --- Consent ---
  @Post('consents')
  async captureConsent(@Body() dto: CaptureConsentDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.capturedBy);
    return this.consent.captureConsent({
      tenantId: dto.tenantId,
      subjectUserId: dto.subjectUserId,
      purpose: dto.purpose,
      version: dto.version,
      policyReference: dto.policyReference,
      source: dto.source,
      correlationId: dto.correlationId,
      capturedBy: actorId,
      evidenceReference: dto.evidenceReference,
    });
  }

  @Post('consents/:id/withdraw')
  async withdrawConsent(@Param('id') id: string, @Body() dto: WithdrawConsentDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.withdrawnBy);
    return this.consent.withdrawConsent({
      tenantId: dto.tenantId,
      consentId: id,
      subjectUserId: dto.subjectUserId,
      correlationId: dto.correlationId,
      withdrawnBy: actorId,
      reason: dto.reason,
    });
  }

  @Get('consents')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async listConsents(@Query('tenantId') tenantId: string, @Query('subjectUserId') subjectUserId: string) {
    if (!tenantId || !subjectUserId) throw new BadRequestException('tenantId and subjectUserId required');
    return this.consent.listConsents(tenantId, subjectUserId);
  }

  // --- Compliance Reports ---
  @Post('reports')
  async generateReport(@Body() dto: GenerateReportDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.createdBy);
    return this.reportService.generateReport({
      tenantId: dto.tenantId,
      reportType: dto.reportType,
      jurisdiction: dto.jurisdiction,
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
      correlationId: dto.correlationId,
      createdBy: actorId,
      sourceData: dto.sourceData,
    });
  }

  @Get('reports')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async listReports(@Query() q: GovernanceQueryDto) {
    if (!q.tenantId) throw new BadRequestException('tenantId required');
    return this.queryService.queryReports({
      tenantId: q.tenantId,
      reportType: q.reportType,
      jurisdiction: q.jurisdiction,
      state: this.enumOption(q.state, Object.values(ReportState), 'report state'),
      correlationId: q.correlationId ?? `corr_${Date.now()}`,
    });
  }

  @Get('reports/:id')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async getReport(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.reportService.getReport(tenantId, id);
  }

  @Post('reports/:id/validate')
  async validateReport(@Param('id') id: string, @Body() dto: ValidateReportDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.validatorId);
    return this.validationService.validateReport({
      tenantId: dto.tenantId,
      reportId: id,
      correlationId: dto.correlationId,
      validatorId: actorId,
      sourceAvailability: dto.sourceAvailability,
    });
  }

  @Post('reports/:id/certification/request')
  async requestCertification(@Param('id') id: string, @Body() dto: RequestCertificationDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.requesterId);
    return this.certificationService.requestCertification({
      tenantId: dto.tenantId,
      reportId: id,
      correlationId: dto.correlationId,
      requesterId: actorId,
    });
  }

  @Post('reports/:id/certification/:certId/certify')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.COMPLIANCE_REVIEWER)
  async certifyReport(@Param('id') id: string, @Param('certId') certId: string, @Body() dto: CertifyReportDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.reviewerId);
    const reviewerRole = dto.reviewerRole.toUpperCase();
    if (!actor.roles.some((role) => role.toUpperCase() === reviewerRole)) throw new ForbiddenException('Reviewer role must be held by the authenticated actor');
    return this.certificationService.certifyReport({
      tenantId: dto.tenantId,
      reportId: id,
      certificationId: certId,
      reviewerId: actorId,
      reviewerRole,
      decision: dto.decision,
      comments: dto.comments,
      correlationId: dto.correlationId,
    });
  }

  @Post('reports/:id/delivery/queue')
  async queueDelivery(@Param('id') id: string, @Body() dto: QueueDeliveryDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.operatorId);
    return this.deliveryService.queueDelivery({
      tenantId: dto.tenantId,
      reportId: id,
      channel: dto.channel,
      correlationId: dto.correlationId,
      operatorId: actorId,
    });
  }

  @Post('reports/:id/delivery/:deliveryId/submit')
  async submitDelivery(@Param('id') id: string, @Param('deliveryId') deliveryId: string, @Body() dto: SubmitDeliveryDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.operatorId);
    const delivery = await this.deliveryService.getDelivery(dto.tenantId, deliveryId);
    if (delivery.reportId !== id) throw new BadRequestException('Delivery does not belong to the report route');
    return this.deliveryService.submitDelivery({
      tenantId: dto.tenantId,
      deliveryId,
      correlationId: dto.correlationId,
      operatorId: actorId,
      deliveryEvidence: dto.deliveryEvidence,
    });
  }

  @Post('reports/:id/delivery/:deliveryId/delivered')
  async markDelivered(@Param('id') id: string, @Param('deliveryId') deliveryId: string, @Body() dto: MarkDeliveredDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.operatorId);
    const delivery = await this.deliveryService.getDelivery(dto.tenantId, deliveryId);
    if (delivery.reportId !== id) throw new BadRequestException('Delivery does not belong to the report route');
    return this.deliveryService.markDelivered({
      tenantId: dto.tenantId,
      deliveryId,
      correlationId: dto.correlationId,
      operatorId: actorId,
      deliveryEvidence: dto.deliveryEvidence,
    });
  }

  @Post('reports/:id/delivery/:deliveryId/failed')
  async markFailed(@Param('id') id: string, @Param('deliveryId') deliveryId: string, @Body() dto: MarkFailedDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.operatorId);
    const delivery = await this.deliveryService.getDelivery(dto.tenantId, deliveryId);
    if (delivery.reportId !== id) throw new BadRequestException('Delivery does not belong to the report route');
    return this.deliveryService.markFailed({
      tenantId: dto.tenantId,
      deliveryId,
      correlationId: dto.correlationId,
      operatorId: actorId,
      failureReason: dto.failureReason,
    });
  }

  @Get('reports/:id/deliveries')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async listDeliveries(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.deliveryService.listDeliveries(tenantId, id);
  }

  @Get('reports/:id/validation')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async getValidation(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.validationService.getValidation(tenantId, id);
  }

  @Get('reports/:id/certifications')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async listCertifications(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.certificationService.listCertifications(tenantId, id);
  }

  // --- Evidence ---
  @Post('evidence-packages')
  async createEvidencePackage(@Body() dto: CreateEvidencePackageDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.createdBy);
    return this.evidence.createPackage({
      tenantId: dto.tenantId,
      caseReference: dto.caseReference,
      evidenceType: dto.evidenceType,
      sourceRecords: dto.sourceRecords,
      sourceReferences: dto.sourceReferences,
      redactionPolicy: dto.redactionPolicy,
      generator: dto.generator,
      correlationId: dto.correlationId,
      createdBy: actorId,
      auditReference: dto.auditReference,
    });
  }

  @Post('evidence-packages/:id/finalize')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.COMPLIANCE_REVIEWER)
  async finalizeEvidencePackage(@Param('id') id: string, @Body() dto: FinalizeEvidencePackageDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.operatorId);
    return this.evidence.finalizePackage({
      tenantId: dto.tenantId,
      packageId: id,
      correlationId: dto.correlationId,
      operatorId: actorId,
    });
  }

  @Get('evidence-packages')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async listEvidencePackages(@Query() q: GovernanceQueryDto) {
    if (!q.tenantId) throw new BadRequestException('tenantId required');
    return this.queryService.queryEvidence({
      tenantId: q.tenantId,
      caseReference: q.caseReference,
      correlationId: q.correlationId ?? `corr_${Date.now()}`,
    });
  }

  // --- Audit ---
  @Get('audit/events')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async listAuditEvents(@Query() q: GovernanceQueryDto) {
    if (!q.tenantId) throw new BadRequestException('tenantId required');
    return this.queryService.queryAudit({
      tenantId: q.tenantId,
      correlationId: q.correlationId ?? `corr_${Date.now()}`,
      filters: { subjectUserId: q.subjectUserId },
    });
  }

  @Post('audit/export')
  @RequireStepUp('AUDIT_EXPORT')
  @RequirePermissions(Permission.COMPLIANCE_READ, Permission.AUDIT_LOG_READ)
  async exportAudit(@Body() dto: AuditExportDto, @CurrentUser() actor: AuthenticatedActor, @Req() request: Request) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.operatorId);
    return this.auditExport.exportAuditTrail({
      tenantId: dto.tenantId,
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
      correlationId: dto.correlationId,
      operatorId: actorId,
      filters: this.auditFilters(dto.filters),
    }, requireMutationKey(request));
  }

  @Get('audit/export/:jobId')
  @RequirePermissions(Permission.COMPLIANCE_READ, Permission.AUDIT_LOG_READ)
  async getAuditExportJob(@Param('jobId') jobId: string, @TenantId() tenantId: string) {
    if (!tenantId) throw new ForbiddenException('Tenant context required');
    return this.auditExport.getJob(tenantId, jobId);
  }

  // --- Reconciliation ---
  @Post('reconciliation/detect')
  async detectReconciliation(@Body() dto: ReconciliationDetectDto, @CurrentUser() actor: AuthenticatedActor) {
    const actorId = this.boundIdentity(dto.tenantId, actor, dto.operatorId);
    return this.reconciliation.detectMismatches({
      tenantId: dto.tenantId,
      correlationId: dto.correlationId,
      operatorId: actorId,
      reportId: dto.reportId,
    });
  }

  @Get('reconciliation/mismatches')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async listMismatches(@Query('tenantId') tenantId: string, @Query('reportId') reportId: string, @Query('type') type: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.reconciliation.listMismatches(tenantId, { reportId, type: this.enumOption(type, MISMATCH_TYPES, 'reconciliation type') });
  }

  // --- Metrics ---
  @Get('metrics')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async getMetrics(@Query('tenantId') tenantId: string, @Query('correlationId') correlationId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.metrics.getMetrics(tenantId, correlationId ?? `corr_${Date.now()}`);
  }

  @Get('overview')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async getOverview(@Query('tenantId') tenantId: string, @Query('correlationId') correlationId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.queryService.queryGovernanceOverview({ tenantId, correlationId: correlationId ?? `corr_${Date.now()}` });
  }

  // --- Data Classification & Inventory ---
  @Get('classification')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async listClassifications(@Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.classification.listClassifications(tenantId);
  }

  @Get('inventory')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async listInventory(@Query('tenantId') tenantId: string, @Query('subjectUserId') subjectUserId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    if (subjectUserId) return this.inventory.listForSubject(tenantId, subjectUserId);
    return this.inventory.listForTenant(tenantId);
  }

  // --- Templates ---
  @Get('templates')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async listTemplates(@Query('jurisdiction') jurisdiction: string) {
    return this.templateService.listTemplates(jurisdiction);
  }

  @Get('templates/:reportType/:jurisdiction')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async getTemplate(@Param('reportType') reportType: string, @Param('jurisdiction') jurisdiction: string) {
    return this.templateService.getTemplate(reportType, jurisdiction);
  }

  // --- Policy ---
  @Get('policy/:jurisdiction')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async getPolicy(@Param('jurisdiction') jurisdiction: string, @Query('tenantId') tenantId: string) {
    return this.policyService.buildPolicy(tenantId ?? null, jurisdiction);
  }
  private boundIdentity(tenantId: string | undefined, actor: AuthenticatedActor, claimed: string | undefined): string {
    // BindTenantParamsGuard separately enforces the explicitly selected tenant for platform operators.
    if (!tenantId || !actor.userId || (!actor.isPlatformUser && actor.tenantId !== tenantId)) throw new ForbiddenException('Authenticated tenant actor required');
    if (claimed !== undefined && claimed !== actor.userId) throw new ForbiddenException('Body audit identity cannot override the authenticated actor');
    return actor.userId;
  }

  private enumOption<T extends string>(value: string | undefined, values: readonly T[], label: string): T | undefined {
    if (value === undefined || value === '') return undefined;
    const option = values.find((candidate) => candidate === value);
    if (!option) throw new BadRequestException(`Invalid ${label}`);
    return option;
  }

  private auditFilters(filters: AuditExportDto['filters']): AuditExportFilters | undefined {
    if (filters === undefined) return undefined;
    if (filters === null || typeof filters !== 'object' || Array.isArray(filters)
      || Object.keys(filters).some((key) => !['actorId', 'actionType', 'subjectUserId', 'entityType', 'entityId', 'outcome'].includes(key))
      || Object.values(filters).some((value) => value !== undefined && (typeof value !== 'string' || value.length > 255))) throw new BadRequestException('Invalid audit export filters');
    const entityTypes = ['REQUEST', 'REPORT', 'EVIDENCE_PACKAGE', 'LEGAL_HOLD', 'RETENTION_CANDIDATE', 'CONSENT'] as const;
    return { actorId: filters.actorId, actionType: this.enumOption(filters.actionType, Object.values(GovernanceActionType), 'audit action type'), subjectUserId: filters.subjectUserId, entityType: this.enumOption(filters.entityType, entityTypes, 'audit entity type'), entityId: filters.entityId, outcome: filters.outcome };
  }

}
