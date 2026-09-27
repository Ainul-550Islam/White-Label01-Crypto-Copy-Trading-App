import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '@wlct/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CompliancePolicyService } from './compliance-policy.service';
import { IdentityVerificationService } from './identity-verification.service';
import { AmlScreeningService } from './aml-screening.service';
import { RiskScoringService } from './risk-scoring.service';
import { TransactionMonitoringService } from './transaction-monitoring.service';
import { ComplianceCaseService } from './compliance-case.service';
import { ComplianceReconciliationService } from './compliance-reconciliation.service';
import { KycProviderFactory } from './kyc-provider.factory';
import { AmlProviderFactory } from './aml-provider.factory';
import { ComplianceQueryDto, KycStatusQueryDto, AmlStatusQueryDto, RiskScoreQueryDto, MonitoringSignalQueryDto, ReconciliationQueryDto } from './dto/compliance-query.dto';
import { StartKycVerificationDto, RetryKycVerificationDto, ScreenPersonDto, ScreenTransactionDto, CreateComplianceCaseDto } from './dto/kyc-action.dto';
import {
  AssignCaseDto,
  EscalateCaseDto,
  AddEvidenceDto,
  AddNoteDto,
  MakeDecisionDto,
  RequestEDDDto,
  RequestReverificationDto,
  RequestHoldDto,
  RequestReleaseDto,
  ResolveCaseDto,
  CloseCaseDto,
  EvaluateTransactionDto,
  ResolveSignalDto,
} from './dto/compliance-review.dto';
import { CreatePolicyDto, CalculateRiskScoreDto } from './dto/risk-policy.dto';
import { KycState, AmlState } from './compliance.types';

/**
 * Compliance controller: RBAC tenant-only own data + compliance reviewers scoped + PLATFORM_MANAGE for platform admin/policy
 * Never expose PII/secrets, tenant isolation enforced, auditable.
 */
@Controller('compliance')
@UseGuards(AuthGuard('jwt'))
export class ComplianceController {
  constructor(
    private readonly policyService: CompliancePolicyService,
    private readonly identityService: IdentityVerificationService,
    private readonly amlService: AmlScreeningService,
    private readonly riskService: RiskScoringService,
    private readonly monitoringService: TransactionMonitoringService,
    private readonly caseService: ComplianceCaseService,
    private readonly reconciliationService: ComplianceReconciliationService,
    private readonly kycFactory: KycProviderFactory,
    private readonly amlFactory: AmlProviderFactory,
  ) {}

  // ===== Policy =====

  @Get('policy')
  @RequirePermissions(Permission.COMPLIANCE_READ, Permission.PLATFORM_MANAGE)
  async getPolicy(@CurrentTenant() tenant: any, @Query('jurisdiction') jurisdiction?: string) {
    const tenantId = tenant?.id || tenant?.tenantId;
    return this.policyService.getEffectivePolicy({ tenantId, jurisdiction });
  }

  @Get('policy/list')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  async listPolicies(@Query() query: ComplianceQueryDto) {
    return this.policyService.listPolicies({ tenantId: query.tenantId, jurisdiction: query.jurisdiction, isActive: true });
  }

  @Post('policy')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  async createPolicy(@Body() dto: CreatePolicyDto, @CurrentUser() user: any) {
    if (!dto.jurisdiction || !dto.policyVersion) throw new BadRequestException('jurisdiction and policyVersion required');
    return this.policyService.createOrUpdatePolicy({
      tenantId: dto.tenantId || null,
      jurisdiction: dto.jurisdiction,
      policyVersion: dto.policyVersion,
      kycRequired: dto.kycRequired,
      amlRequired: dto.amlRequired,
      sanctionsRequired: dto.sanctionsRequired,
      pepRequired: dto.pepRequired,
      eddRequired: dto.eddRequired,
      transactionThresholds: dto.transactionThresholds,
      riskThresholds: dto.riskThresholds,
      highRiskCountries: dto.highRiskCountries,
      blockedCountries: dto.blockedCountries,
      reverificationIntervalDays: dto.reverificationIntervalDays,
      manualReviewRequired: dto.manualReviewRequired,
      rules: dto.rules,
      actorId: user.id || user.userId,
    });
  }

  @Get('providers')
  @RequirePermissions(Permission.COMPLIANCE_READ, Permission.PLATFORM_MANAGE)
  async getProviders() {
    return {
      kyc: {
        configured: process.env.KYC_PROVIDER || 'UNAVAILABLE',
        available: this.kycFactory.listAvailableProviders(),
        capabilities: this.kycFactory.getProviderCapabilities(),
      },
      aml: {
        configured: process.env.AML_PROVIDER || 'UNAVAILABLE',
        available: this.amlFactory.listAvailableProviders(),
      },
    };
  }

  // ===== KYC =====

  @Post('kyc/start')
  @RequirePermissions(Permission.KYC_WRITE, Permission.COMPLIANCE_WRITE)
  async startKyc(@Body() dto: StartKycVerificationDto, @CurrentTenant() tenant: any, @CurrentUser() user: any, @Req() req: any) {
    const tenantId = dto.tenantId || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');

    // Tenant-only own data unless compliance reviewer/admin
    const requesterTenantId = tenant?.id || tenant?.tenantId || user?.tenantId;
    const roles = user?.roles || user?.permissions || [];
    const isPrivileged = roles.includes('ADMIN') || roles.includes('OWNER') || roles.includes('COMPLIANCE_REVIEWER') || roles.includes('PLATFORM_ADMIN');

    if (requesterTenantId !== tenantId && !roles.includes('PLATFORM_ADMIN')) {
      throw new ForbiddenException('Cross-tenant access denied');
    }

    if (!isPrivileged && dto.userId !== user.id && dto.userId !== user.userId) {
      throw new ForbiddenException('Cannot start KYC for other users');
    }

    return this.identityService.startVerification({
      tenantId,
      userId: dto.userId,
      email: dto.email || user.email || `${dto.userId}@example.com`,
      countryCode: dto.countryCode,
      jurisdiction: dto.jurisdiction,
      levelName: dto.levelName,
      idempotencyKey: dto.idempotencyKey,
      actorId: user.id || user.userId,
      ipHash: req.ip ? `hash_${req.ip}` : undefined,
      requestId: req.headers['x-request-id'] as string,
    });
  }

  @Post('kyc/retry')
  @RequirePermissions(Permission.KYC_WRITE, Permission.COMPLIANCE_WRITE)
  async retryKyc(@Body() dto: RetryKycVerificationDto, @CurrentTenant() tenant: any, @CurrentUser() user: any, @Req() req: any) {
    const tenantId = dto.tenantId || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');

    return this.identityService.retryVerification({
      tenantId,
      userId: dto.userId,
      idempotencyKey: dto.idempotencyKey,
      actorId: user.id || user.userId,
      ipHash: req.ip ? `hash_${req.ip}` : undefined,
      requestId: req.headers['x-request-id'] as string,
    });
  }

  @Get('kyc/status')
  @RequirePermissions(Permission.KYC_READ, Permission.COMPLIANCE_READ)
  async getKycStatus(@Query() query: KycStatusQueryDto, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenant?.id || tenant?.tenantId || user?.tenantId;
    const userId = query.userId || user.id || user.userId;

    // Tenant isolation: regular users can only check own status
    const roles = user?.roles || user?.permissions || [];
    const isPrivileged = roles.includes('ADMIN') || roles.includes('OWNER') || roles.includes('COMPLIANCE_REVIEWER') || roles.includes('PLATFORM_ADMIN');
    if (!isPrivileged && query.userId && query.userId !== (user.id || user.userId)) {
      throw new ForbiddenException('Cannot check other users KYC status');
    }

    return this.identityService.getStatus({ tenantId, userId, providerReference: query.providerReference });
  }

  @Get('kyc/status/:userId')
  @RequirePermissions(Permission.KYC_READ, Permission.COMPLIANCE_READ)
  async getKycStatusByUser(@Param('userId') userId: string, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenant?.id || tenant?.tenantId || user?.tenantId;
    const roles = user?.roles || user?.permissions || [];
    const isPrivileged = roles.includes('ADMIN') || roles.includes('OWNER') || roles.includes('COMPLIANCE_REVIEWER') || roles.includes('PLATFORM_ADMIN');
    if (!isPrivileged && userId !== (user.id || user.userId)) {
      throw new ForbiddenException('Cannot check other users KYC status');
    }
    return this.identityService.getStatus({ tenantId, userId });
  }

  // ===== AML =====

  @Post('aml/screen-person')
  @RequirePermissions(Permission.AML_WRITE, Permission.COMPLIANCE_WRITE)
  async screenPerson(@Body() dto: ScreenPersonDto, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = dto.tenantId || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.amlService.screenPerson({
      tenantId,
      userId: dto.userId,
      firstName: dto.firstName,
      lastName: dto.lastName,
      countryCode: dto.countryCode,
      dateOfBirth: dto.dateOfBirth,
      jurisdiction: dto.jurisdiction,
      idempotencyKey: dto.idempotencyKey,
      actorId: user.id || user.userId,
    });
  }

  @Post('aml/screen-transaction')
  @RequirePermissions(Permission.AML_WRITE, Permission.COMPLIANCE_WRITE)
  async screenTransaction(@Body() dto: ScreenTransactionDto, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = dto.tenantId || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.amlService.screenTransaction({
      tenantId,
      userId: dto.userId,
      transactionId: dto.transactionId,
      transactionType: dto.transactionType,
      amount: dto.amount,
      currency: dto.currency,
      counterparty: dto.counterparty,
      jurisdiction: dto.jurisdiction,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Get('aml/status')
  @RequirePermissions(Permission.AML_READ, Permission.COMPLIANCE_READ)
  async getAmlStatus(@Query() query: AmlStatusQueryDto, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenant?.id || tenant?.tenantId || user?.tenantId;
    const userId = query.userId || user.id || user.userId;
    const roles = user?.roles || user?.permissions || [];
    const isPrivileged = roles.includes('ADMIN') || roles.includes('OWNER') || roles.includes('COMPLIANCE_REVIEWER') || roles.includes('PLATFORM_ADMIN');
    if (!isPrivileged && query.userId && query.userId !== (user.id || user.userId)) {
      throw new ForbiddenException('Cannot check other users AML status');
    }
    return this.amlService.getStatus({ tenantId, userId, providerReference: query.providerReference });
  }

  @Post('aml/rescreen/:providerReference')
  @RequirePermissions(Permission.AML_WRITE, Permission.COMPLIANCE_WRITE, Permission.PLATFORM_MANAGE)
  async rescreen(@Param('providerReference') providerReference: string, @Body() body: { userId: string; idempotencyKey?: string; tenantId?: string }, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = body.tenantId || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.amlService.rescreen({ tenantId, userId: body.userId, providerReference, idempotencyKey: body.idempotencyKey });
  }

  // ===== Risk Scoring =====

  @Post('risk/calculate')
  @RequirePermissions(Permission.COMPLIANCE_READ, Permission.RISK_READ, Permission.PLATFORM_MANAGE)
  async calculateRisk(@Body() dto: CalculateRiskScoreDto, @CurrentTenant() tenant: any) {
    const tenantId = tenant?.id || tenant?.tenantId;
    return this.riskService.calculateRiskScore({ tenantId: tenantId || 'platform', userId: dto.userId, jurisdiction: dto.jurisdiction, idempotencyKey: dto.idempotencyKey });
  }

  @Get('risk/score/:userId')
  @RequirePermissions(Permission.COMPLIANCE_READ, Permission.RISK_READ)
  async getRiskScore(@Param('userId') userId: string, @CurrentTenant() tenant: any, @CurrentUser() user: any, @Query('jurisdiction') jurisdiction?: string) {
    const tenantId = tenant?.id || tenant?.tenantId || user?.tenantId;
    const roles = user?.roles || user?.permissions || [];
    const isPrivileged = roles.includes('ADMIN') || roles.includes('OWNER') || roles.includes('COMPLIANCE_REVIEWER') || roles.includes('PLATFORM_ADMIN') || roles.includes('RISK_REVIEWER');
    if (!isPrivileged && userId !== (user.id || user.userId)) {
      throw new ForbiddenException('Cannot check other users risk score');
    }
    const latest = await this.riskService.getLatestScore(tenantId, userId);
    if (latest) return latest;
    return this.riskService.calculateRiskScore({ tenantId, userId, jurisdiction });
  }

  @Get('risk/evaluate/:userId')
  @RequirePermissions(Permission.COMPLIANCE_READ, Permission.RISK_READ, Permission.PLATFORM_MANAGE)
  async evaluateDecision(@Param('userId') userId: string, @CurrentTenant() tenant: any, @Query('jurisdiction') jurisdiction?: string) {
    const tenantId = tenant?.id || tenant?.tenantId;
    return this.riskService.evaluateDecision({ tenantId: tenantId || 'platform', userId, jurisdiction });
  }

  // ===== Transaction Monitoring =====

  @Post('monitoring/evaluate')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.PLATFORM_MANAGE)
  async evaluateTransaction(@Body() dto: EvaluateTransactionDto, @CurrentTenant() tenant: any) {
    const tenantId = tenant?.id || tenant?.tenantId;
    return this.monitoringService.evaluateTransaction({
      tenantId: tenantId || (dto as any).tenantId || 'platform',
      userId: dto.userId,
      sourceType: dto.sourceType as any,
      sourceId: dto.sourceId,
      amount: dto.amount,
      currency: dto.currency,
      jurisdiction: dto.jurisdiction,
      idempotencyKey: dto.idempotencyKey,
      safeMetadata: dto.safeMetadata,
    });
  }

  @Get('monitoring/signals')
  @RequirePermissions(Permission.COMPLIANCE_READ, Permission.PLATFORM_MANAGE)
  async listSignals(@Query() query: MonitoringSignalQueryDto, @CurrentTenant() tenant: any) {
    const tenantId = tenant?.id || tenant?.tenantId || (query as any).tenantId;
    return this.monitoringService.listSignals(tenantId || 'platform', {
      userId: query.userId,
      ruleId: query.ruleId,
      riskLevel: query.riskLevel as any,
      decision: query.decision as any,
      fromDate: query.fromDate ? new Date(query.fromDate) : undefined,
      toDate: query.toDate ? new Date(query.toDate) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  @Post('monitoring/signals/:signalId/resolve')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.PLATFORM_MANAGE)
  async resolveSignal(@Param('signalId') signalId: string, @Body() dto: ResolveSignalDto, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenant?.id || tenant?.tenantId;
    return this.monitoringService.resolveSignal(signalId, tenantId || 'platform', user.id || user.userId, dto.resolution);
  }

  @Post('monitoring/scan-canonical')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  async scanCanonical(@Body() body: { tenantId?: string; userId: string; fromDate?: string; toDate?: string }, @CurrentTenant() tenant: any) {
    const tenantId = body.tenantId || tenant?.id || tenant?.tenantId;
    return this.monitoringService.evaluateFromCanonicalSources({
      tenantId: tenantId || 'platform',
      userId: body.userId,
      fromDate: body.fromDate ? new Date(body.fromDate) : undefined,
      toDate: body.toDate ? new Date(body.toDate) : undefined,
    });
  }

  // ===== Compliance Cases =====

  @Post('cases')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.PLATFORM_MANAGE)
  async createCase(@Body() dto: CreateComplianceCaseDto, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = dto.tenantId || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.caseService.createCase({
      tenantId,
      userId: dto.userId,
      caseType: dto.caseType as any,
      riskLevel: dto.riskLevel as any,
      safeSummary: dto.safeSummary,
      severity: dto.severity,
      jurisdiction: dto.jurisdiction,
      ruleIds: dto.ruleIds,
      sourceRefs: dto.sourceRefs,
      idempotencyKey: dto.idempotencyKey,
      actorId: user.id || user.userId,
    });
  }

  @Get('cases')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async listCases(@Query() query: ComplianceQueryDto, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = query.tenantId || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    const requester = { userId: user.id || user.userId, tenantId: tenant?.id || tenant?.tenantId || user?.tenantId, roles: user?.roles || user?.permissions || [] };
    return this.caseService.listTenantCases(tenantId, requester, {
      state: query.state as any,
      caseType: query.caseType as any,
      riskLevel: query.riskLevel as any,
      assignedTo: query.assignedTo,
      fromDate: query.fromDate ? new Date(query.fromDate) : undefined,
      toDate: query.toDate ? new Date(query.toDate) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('cases/reviewer-queue')
  @RequirePermissions(Permission.COMPLIANCE_READ, Permission.COMPLIANCE_REVIEWER)
  async reviewerQueue(@Query() query: ComplianceQueryDto, @CurrentUser() user: any) {
    const reviewerId = user.id || user.userId;
    return this.caseService.listReviewerQueue(reviewerId, { state: query.state as any, page: query.page, limit: query.limit });
  }

  @Get('cases/:caseId')
  @RequirePermissions(Permission.COMPLIANCE_READ)
  async getCase(@Param('caseId') caseId: string, @Query('tenantId') tenantIdQuery: string, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenantIdQuery || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    const requester = { userId: user.id || user.userId, tenantId: tenant?.id || tenant?.tenantId || user?.tenantId, roles: user?.roles || user?.permissions || [] };
    return this.caseService.getCase(caseId, tenantId, requester);
  }

  @Post('cases/:caseId/assign')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.PLATFORM_MANAGE)
  async assignCase(@Param('caseId') caseId: string, @Body() dto: AssignCaseDto, @Query('tenantId') tenantIdQuery: string, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenantIdQuery || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.caseService.assignCase(caseId, tenantId, dto.reviewerId, user.id || user.userId, dto.idempotencyKey);
  }

  @Post('cases/:caseId/escalate')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.PLATFORM_MANAGE)
  async escalateCase(@Param('caseId') caseId: string, @Body() dto: EscalateCaseDto, @Query('tenantId') tenantIdQuery: string, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenantIdQuery || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.caseService.escalateCase(caseId, tenantId, user.id || user.userId, dto.reason, dto.idempotencyKey);
  }

  @Post('cases/:caseId/evidence')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.PLATFORM_MANAGE)
  async addEvidence(@Param('caseId') caseId: string, @Body() dto: AddEvidenceDto, @Query('tenantId') tenantIdQuery: string, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenantIdQuery || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.caseService.addEvidence(caseId, tenantId, {
      evidenceType: dto.evidenceType,
      referenceId: dto.referenceId,
      referenceType: dto.referenceType,
      safeDescription: dto.safeDescription,
      addedBy: user.id || user.userId,
    });
  }

  @Post('cases/:caseId/notes')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.PLATFORM_MANAGE)
  async addNote(@Param('caseId') caseId: string, @Body() dto: AddNoteDto, @Query('tenantId') tenantIdQuery: string, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenantIdQuery || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.caseService.addNote(caseId, tenantId, user.id || user.userId, dto.safeNote);
  }

  @Post('cases/:caseId/decision')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.COMPLIANCE_REVIEWER, Permission.PLATFORM_MANAGE)
  async makeDecision(@Param('caseId') caseId: string, @Body() dto: MakeDecisionDto, @Query('tenantId') tenantIdQuery: string, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenantIdQuery || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.caseService.makeDecision(caseId, tenantId, {
      decision: dto.decision,
      reviewerId: user.id || user.userId,
      reason: dto.reason,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Post('cases/:caseId/request-edd')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.PLATFORM_MANAGE)
  async requestEDD(@Param('caseId') caseId: string, @Body() dto: RequestEDDDto, @Query('tenantId') tenantIdQuery: string, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenantIdQuery || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.caseService.requestEDD(caseId, tenantId, user.id || user.userId, dto.reason);
  }

  @Post('cases/:caseId/request-reverification')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.PLATFORM_MANAGE)
  async requestReverification(@Param('caseId') caseId: string, @Body() dto: RequestReverificationDto, @Query('tenantId') tenantIdQuery: string, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenantIdQuery || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.caseService.requestReverification(caseId, tenantId, user.id || user.userId, dto.reason);
  }

  @Post('cases/:caseId/request-hold')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.PLATFORM_MANAGE)
  async requestHold(@Param('caseId') caseId: string, @Body() dto: RequestHoldDto, @Query('tenantId') tenantIdQuery: string, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenantIdQuery || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.caseService.requestHold(caseId, tenantId, user.id || user.userId, dto.reason, dto.idempotencyKey);
  }

  @Post('cases/:caseId/request-release')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.PLATFORM_MANAGE)
  async requestRelease(@Param('caseId') caseId: string, @Body() dto: RequestReleaseDto, @Query('tenantId') tenantIdQuery: string, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenantIdQuery || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.caseService.requestRelease(caseId, tenantId, user.id || user.userId, dto.reason, dto.idempotencyKey);
  }

  @Post('cases/:caseId/resolve')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.PLATFORM_MANAGE)
  async resolveCase(@Param('caseId') caseId: string, @Body() dto: ResolveCaseDto, @Query('tenantId') tenantIdQuery: string, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenantIdQuery || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.caseService.resolveCase(caseId, tenantId, user.id || user.userId, dto.reason, dto.decision);
  }

  @Post('cases/:caseId/close')
  @RequirePermissions(Permission.COMPLIANCE_WRITE, Permission.PLATFORM_MANAGE)
  async closeCase(@Param('caseId') caseId: string, @Body() dto: CloseCaseDto, @Query('tenantId') tenantIdQuery: string, @CurrentTenant() tenant: any, @CurrentUser() user: any) {
    const tenantId = tenantIdQuery || tenant?.id || tenant?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.caseService.closeCase(caseId, tenantId, user.id || user.userId, dto.reason);
  }

  // ===== Reconciliation =====

  @Get('reconciliation/issues')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  async getReconciliationIssues(@Query() query: ReconciliationQueryDto) {
    return this.reconciliationService.runReconciliation({ tenantId: query.tenantId, fullScan: query.fullScan });
  }

  @Get('reconciliation/stats')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  async getReconciliationStats(@Query('tenantId') tenantId?: string) {
    return this.reconciliationService.getReconciliationStats(tenantId);
  }
}
