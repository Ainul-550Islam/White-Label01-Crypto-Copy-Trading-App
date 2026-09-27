import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
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
import { GovernanceAuditService } from './governance-audit.service';
import { GovernanceAuditExportService } from './governance-audit-export.service';
import { GovernanceReconciliationService } from './governance-reconciliation.service';
import { GovernanceMetricsService } from './governance-metrics.service';
import { GovernanceActionService } from './governance-action.service';
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

@Controller('v1/governance')
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
    private readonly audit: GovernanceAuditService,
    private readonly auditExport: GovernanceAuditExportService,
    private readonly reconciliation: GovernanceReconciliationService,
    private readonly metrics: GovernanceMetricsService,
    private readonly actionService: GovernanceActionService,
    private readonly queryService: GovernanceReportQueryService,
    private readonly classification: DataClassificationService,
    private readonly inventory: DataInventoryService,
    private readonly policyService: GovernancePolicyService,
  ) {}

  // --- Privacy Requests ---
  @Post('privacy-requests')
  async createPrivacyRequest(@Body() dto: CreatePrivacyRequestDto) {
    return this.privacyRequest.createRequest({
      tenantId: dto.tenantId,
      subjectUserId: dto.subjectUserId,
      subjectType: dto.subjectType,
      requestType: dto.requestType,
      jurisdiction: dto.jurisdiction,
      reason: dto.reason,
      idempotencyKey: dto.idempotencyKey,
      correlationId: dto.correlationId,
      createdBy: dto.createdBy,
    });
  }

  @Put('privacy-requests/:id/transition')
  async transitionPrivacyRequest(@Param('id') id: string, @Body() dto: TransitionPrivacyRequestDto) {
    return this.privacyRequest.transitionRequest({
      tenantId: dto.tenantId,
      requestId: id,
      targetState: dto.targetState,
      correlationId: dto.correlationId,
      operatorId: dto.operatorId,
      reason: dto.reason,
      verificationEvidence: dto.verificationEvidence,
    });
  }

  @Get('privacy-requests')
  async listPrivacyRequests(@Query() q: GovernanceQueryDto) {
    if (!q.tenantId) throw new BadRequestException('tenantId required');
    return this.queryService.queryPrivacyRequests({
      tenantId: q.tenantId,
      subjectUserId: q.subjectUserId,
      state: q.state as any,
      correlationId: q.correlationId ?? `corr_${Date.now()}`,
    });
  }

  @Get('privacy-requests/:id')
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
  async exportForRequest(@Param('id') id: string, @Body() body: { tenantId: string; jurisdiction: string; correlationId: string; operatorId: string }) {
    const req = await this.privacyRequest.getRequest(body.tenantId, id);
    return this.privacyExport.generateExport({
      tenantId: body.tenantId,
      requestId: id,
      subjectUserId: req.subjectUserId,
      jurisdiction: body.jurisdiction,
      correlationId: body.correlationId,
      operatorId: body.operatorId,
    });
  }

  @Post('privacy-requests/:id/deletion-check')
  async checkDeletion(@Param('id') id: string, @Body() dto: PrivacyDeletionCheckDto) {
    return this.privacyDeletion.checkDeletionEligibility({
      tenantId: dto.tenantId,
      subjectUserId: dto.subjectUserId,
      requestId: id,
      jurisdiction: dto.jurisdiction,
      correlationId: dto.correlationId,
      operatorId: dto.operatorId,
    });
  }

  @Post('privacy-requests/:id/deletion-execute')
  async executeDeletion(@Param('id') id: string, @Body() dto: PrivacyDeletionExecuteDto) {
    return this.privacyDeletion.executeDeletion({
      tenantId: dto.tenantId,
      subjectUserId: dto.subjectUserId,
      requestId: id,
      jurisdiction: dto.jurisdiction,
      correlationId: dto.correlationId,
      operatorId: dto.operatorId,
      dryRun: dto.dryRun,
    });
  }

  // --- Retention ---
  @Get('retention/policies')
  async getRetentionPolicies(@Query('tenantId') tenantId: string, @Query('jurisdiction') jurisdiction: string) {
    if (!jurisdiction) throw new BadRequestException('jurisdiction required');
    return this.retentionPolicy.getPolicies(tenantId ?? null, jurisdiction);
  }

  @Post('retention/evaluate')
  async evaluateRetention(@Body() dto: EvaluateRetentionDto) {
    return this.retentionEngine.evaluateCandidate({
      tenantId: dto.tenantId,
      dataClass: dto.dataClass,
      sourceSystem: dto.sourceSystem,
      sourceId: dto.sourceId,
      jurisdiction: dto.jurisdiction,
      retentionStartAt: dto.retentionStartAt,
      correlationId: dto.correlationId,
      operatorId: dto.operatorId,
    });
  }

  @Post('retention/:id/action')
  async executeRetentionAction(@Param('id') id: string, @Body() dto: ExecuteRetentionActionDto) {
    return this.retentionEngine.executeAction({
      tenantId: dto.tenantId,
      candidateId: id,
      action: dto.action,
      correlationId: dto.correlationId,
      operatorId: dto.operatorId,
      reason: dto.reason,
    });
  }

  @Get('retention/candidates')
  async listRetentionCandidates(@Query() q: GovernanceQueryDto) {
    if (!q.tenantId) throw new BadRequestException('tenantId required');
    return this.retentionEngine.listCandidates(q.tenantId, { state: q.state as any });
  }

  // --- Legal Hold ---
  @Post('legal-holds')
  async createLegalHold(@Body() dto: CreateLegalHoldDto) {
    return this.legalHold.createHold({
      tenantId: dto.tenantId ?? null,
      caseReference: dto.caseReference,
      reason: dto.reason,
      affectedDataClasses: dto.affectedDataClasses,
      affectedJurisdictions: dto.affectedJurisdictions,
      affectedSubjects: dto.affectedSubjects,
      createdBy: dto.createdBy,
      correlationId: dto.correlationId,
      expiresAt: dto.expiresAt ?? null,
    });
  }

  @Post('legal-holds/:id/activate')
  async activateLegalHold(@Param('id') id: string, @Body() dto: ActivateLegalHoldDto) {
    return this.legalHold.activateHold({
      holdId: id,
      tenantId: dto.tenantId ?? null,
      activatedBy: dto.activatedBy,
      correlationId: dto.correlationId,
    });
  }

  @Post('legal-holds/:id/release')
  async releaseLegalHold(@Param('id') id: string, @Body() dto: ReleaseLegalHoldDto) {
    return this.legalHold.releaseHold({
      holdId: id,
      tenantId: dto.tenantId ?? null,
      releasedBy: dto.releasedBy,
      correlationId: dto.correlationId,
      reason: dto.reason,
    });
  }

  @Get('legal-holds')
  async listLegalHolds(@Query('tenantId') tenantId: string, @Query('state') state: string) {
    return this.legalHold.listHolds(tenantId ?? null, { state: state as any });
  }

  @Get('legal-holds/active')
  async listActiveLegalHolds(@Query('tenantId') tenantId: string) {
    return this.legalHold.listActiveHolds(tenantId ?? null);
  }

  // --- Consent ---
  @Post('consents')
  async captureConsent(@Body() dto: CaptureConsentDto) {
    return this.consent.captureConsent({
      tenantId: dto.tenantId,
      subjectUserId: dto.subjectUserId,
      purpose: dto.purpose,
      version: dto.version,
      policyReference: dto.policyReference,
      source: dto.source,
      correlationId: dto.correlationId,
      capturedBy: dto.capturedBy,
      evidenceReference: dto.evidenceReference,
    });
  }

  @Post('consents/:id/withdraw')
  async withdrawConsent(@Param('id') id: string, @Body() dto: WithdrawConsentDto) {
    return this.consent.withdrawConsent({
      tenantId: dto.tenantId,
      consentId: id,
      subjectUserId: dto.subjectUserId,
      correlationId: dto.correlationId,
      withdrawnBy: dto.withdrawnBy,
      reason: dto.reason,
    });
  }

  @Get('consents')
  async listConsents(@Query('tenantId') tenantId: string, @Query('subjectUserId') subjectUserId: string) {
    if (!tenantId || !subjectUserId) throw new BadRequestException('tenantId and subjectUserId required');
    return this.consent.listConsents(tenantId, subjectUserId);
  }

  // --- Compliance Reports ---
  @Post('reports')
  async generateReport(@Body() dto: GenerateReportDto) {
    return this.reportService.generateReport({
      tenantId: dto.tenantId,
      reportType: dto.reportType,
      jurisdiction: dto.jurisdiction,
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
      correlationId: dto.correlationId,
      createdBy: dto.createdBy,
      sourceData: dto.sourceData,
    });
  }

  @Get('reports')
  async listReports(@Query() q: GovernanceQueryDto) {
    if (!q.tenantId) throw new BadRequestException('tenantId required');
    return this.queryService.queryReports({
      tenantId: q.tenantId,
      reportType: q.reportType,
      jurisdiction: q.jurisdiction,
      state: q.state as any,
      correlationId: q.correlationId ?? `corr_${Date.now()}`,
    });
  }

  @Get('reports/:id')
  async getReport(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.reportService.getReport(tenantId, id);
  }

  @Post('reports/:id/validate')
  async validateReport(@Param('id') id: string, @Body() dto: ValidateReportDto) {
    return this.validationService.validateReport({
      tenantId: dto.tenantId,
      reportId: id,
      correlationId: dto.correlationId,
      validatorId: dto.validatorId,
      sourceAvailability: dto.sourceAvailability,
    });
  }

  @Post('reports/:id/certification/request')
  async requestCertification(@Param('id') id: string, @Body() dto: RequestCertificationDto) {
    return this.certificationService.requestCertification({
      tenantId: dto.tenantId,
      reportId: id,
      correlationId: dto.correlationId,
      requesterId: dto.requesterId,
    });
  }

  @Post('reports/:id/certification/:certId/certify')
  async certifyReport(@Param('id') id: string, @Param('certId') certId: string, @Body() dto: CertifyReportDto) {
    return this.certificationService.certifyReport({
      tenantId: dto.tenantId,
      reportId: id,
      certificationId: certId,
      reviewerId: dto.reviewerId,
      reviewerRole: dto.reviewerRole,
      decision: dto.decision,
      comments: dto.comments,
      correlationId: dto.correlationId,
    });
  }

  @Post('reports/:id/delivery/queue')
  async queueDelivery(@Param('id') id: string, @Body() dto: QueueDeliveryDto) {
    return this.deliveryService.queueDelivery({
      tenantId: dto.tenantId,
      reportId: id,
      channel: dto.channel,
      correlationId: dto.correlationId,
      operatorId: dto.operatorId,
    });
  }

  @Post('reports/:id/delivery/:deliveryId/submit')
  async submitDelivery(@Param('id') id: string, @Param('deliveryId') deliveryId: string, @Body() dto: SubmitDeliveryDto) {
    return this.deliveryService.submitDelivery({
      tenantId: dto.tenantId,
      deliveryId,
      correlationId: dto.correlationId,
      operatorId: dto.operatorId,
      deliveryEvidence: dto.deliveryEvidence,
    });
  }

  @Post('reports/:id/delivery/:deliveryId/delivered')
  async markDelivered(@Param('id') id: string, @Param('deliveryId') deliveryId: string, @Body() dto: MarkDeliveredDto) {
    return this.deliveryService.markDelivered({
      tenantId: dto.tenantId,
      deliveryId,
      correlationId: dto.correlationId,
      operatorId: dto.operatorId,
      deliveryEvidence: dto.deliveryEvidence,
    });
  }

  @Post('reports/:id/delivery/:deliveryId/failed')
  async markFailed(@Param('id') id: string, @Param('deliveryId') deliveryId: string, @Body() dto: MarkFailedDto) {
    return this.deliveryService.markFailed({
      tenantId: dto.tenantId,
      deliveryId,
      correlationId: dto.correlationId,
      operatorId: dto.operatorId,
      failureReason: dto.failureReason,
    });
  }

  @Get('reports/:id/deliveries')
  async listDeliveries(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.deliveryService.listDeliveries(tenantId, id);
  }

  @Get('reports/:id/validation')
  async getValidation(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.validationService.getValidation(tenantId, id);
  }

  @Get('reports/:id/certifications')
  async listCertifications(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.certificationService.listCertifications(tenantId, id);
  }

  // --- Evidence ---
  @Post('evidence-packages')
  async createEvidencePackage(@Body() dto: CreateEvidencePackageDto) {
    return this.evidence.createPackage({
      tenantId: dto.tenantId,
      caseReference: dto.caseReference,
      evidenceType: dto.evidenceType,
      sourceRecords: dto.sourceRecords,
      sourceReferences: dto.sourceReferences,
      redactionPolicy: dto.redactionPolicy,
      generator: dto.generator,
      correlationId: dto.correlationId,
      createdBy: dto.createdBy,
      auditReference: dto.auditReference,
    });
  }

  @Post('evidence-packages/:id/finalize')
  async finalizeEvidencePackage(@Param('id') id: string, @Body() dto: FinalizeEvidencePackageDto) {
    return this.evidence.finalizePackage({
      tenantId: dto.tenantId,
      packageId: id,
      correlationId: dto.correlationId,
      operatorId: dto.operatorId,
    });
  }

  @Get('evidence-packages')
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
  async listAuditEvents(@Query() q: GovernanceQueryDto) {
    if (!q.tenantId) throw new BadRequestException('tenantId required');
    return this.queryService.queryAudit({
      tenantId: q.tenantId,
      correlationId: q.correlationId ?? `corr_${Date.now()}`,
      filters: { subjectUserId: q.subjectUserId },
    });
  }

  @Post('audit/export')
  async exportAudit(@Body() dto: AuditExportDto) {
    return this.auditExport.exportAuditTrail({
      tenantId: dto.tenantId,
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
      correlationId: dto.correlationId,
      operatorId: dto.operatorId,
      filters: dto.filters as any,
    });
  }

  // --- Reconciliation ---
  @Post('reconciliation/detect')
  async detectReconciliation(@Body() dto: ReconciliationDetectDto) {
    return this.reconciliation.detectMismatches({
      tenantId: dto.tenantId,
      correlationId: dto.correlationId,
      operatorId: dto.operatorId,
      reportId: dto.reportId,
    });
  }

  @Get('reconciliation/mismatches')
  async listMismatches(@Query('tenantId') tenantId: string, @Query('reportId') reportId: string, @Query('type') type: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.reconciliation.listMismatches(tenantId, { reportId, type: type as any });
  }

  // --- Metrics ---
  @Get('metrics')
  async getMetrics(@Query('tenantId') tenantId: string, @Query('correlationId') correlationId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.metrics.getMetrics(tenantId, correlationId ?? `corr_${Date.now()}`);
  }

  @Get('overview')
  async getOverview(@Query('tenantId') tenantId: string, @Query('correlationId') correlationId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.queryService.queryGovernanceOverview({ tenantId, correlationId: correlationId ?? `corr_${Date.now()}` });
  }

  // --- Data Classification & Inventory ---
  @Get('classification')
  async listClassifications(@Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.classification.listClassifications(tenantId);
  }

  @Get('inventory')
  async listInventory(@Query('tenantId') tenantId: string, @Query('subjectUserId') subjectUserId: string) {
    if (!tenantId) throw new BadRequestException('tenantId required');
    if (subjectUserId) return this.inventory.listForSubject(tenantId, subjectUserId);
    return this.inventory.listForTenant(tenantId);
  }

  // --- Templates ---
  @Get('templates')
  async listTemplates(@Query('jurisdiction') jurisdiction: string) {
    return this.templateService.listTemplates(jurisdiction);
  }

  @Get('templates/:reportType/:jurisdiction')
  async getTemplate(@Param('reportType') reportType: string, @Param('jurisdiction') jurisdiction: string) {
    return this.templateService.getTemplate(reportType, jurisdiction);
  }

  // --- Policy ---
  @Get('policy/:jurisdiction')
  async getPolicy(@Param('jurisdiction') jurisdiction: string, @Query('tenantId') tenantId: string) {
    return this.policyService.buildPolicy(tenantId ?? null, jurisdiction);
  }
}
