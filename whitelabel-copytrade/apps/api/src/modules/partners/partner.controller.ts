import { Controller, Get, Post, Put, Body, Param, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { PartnerProfileService } from './partner-profile.service';
import { PartnerAgreementService } from './partner-agreement.service';
import { PartnerTenantService } from './partner-tenant.service';
import { PartnerUserService } from './partner-user.service';
import { PartnerPlanService } from './partner-plan.service';
import { PartnerPricingService } from './partner-pricing.service';
import { PartnerDiscountService } from './partner-discount.service';
import { PartnerReferralService } from './partner-referral.service';
import { PartnerAttributionService } from './partner-attribution.service';
import { PartnerCommissionService } from './partner-commission.service';
import { PartnerCommissionLedgerService } from './partner-commission-ledger.service';
import { PartnerPayoutService } from './partner-payout.service';
import { PartnerInvoiceService } from './partner-invoice.service';
import { PartnerSettlementService } from './partner-settlement.service';
import { PartnerUsageService } from './partner-usage.service';
import { PartnerPerformanceService } from './partner-performance.service';
import { PartnerAnalyticsService } from './partner-analytics.service';
import { PartnerReconciliationService } from './partner-reconciliation.service';
import { PartnerPortalService } from './partner-portal.service';
import { PartnerAuditService } from './partner-audit.service';
import { PartnerPolicyService } from './partner-policy.service';
import {
  CreatePartnerProfileDto,
  UpdatePartnerProfileDto,
  TransitionPartnerStateDto,
  CreatePartnerAgreementDto,
  TransitionAgreementStateDto,
  InvitePartnerUserDto,
  ChangePartnerUserRoleDto,
} from './dto/partner-profile.dto';
import { AssignTenantDto, TransferTenantDto, UnassignTenantDto, CreateTenantForPartnerDto } from './dto/partner-tenant-action.dto';
import {
  CreateCampaignDto,
  CreateReferralDto,
  CreateAttributionDto,
  CalculateCommissionDto,
  ReverseCommissionDto,
  CreateSettlementDto,
  RequestPayoutDto,
  TransitionPayoutDto,
  TransitionCampaignStateDto,
} from './dto/partner-campaign.dto';
import {
  PartnerQueryDto,
  PartnerTenantQueryDto,
  PartnerCommissionQueryDto,
  PartnerSettlementQueryDto,
  PartnerPayoutQueryDto,
  PartnerAnalyticsQueryDto,
  PartnerPortalQueryDto,
  ReconciliationQueryDto,
} from './dto/partner-query.dto';

@Controller('v1/partners')
export class PartnerController {
  constructor(
    private readonly profileService: PartnerProfileService,
    private readonly agreementService: PartnerAgreementService,
    private readonly tenantService: PartnerTenantService,
    private readonly userService: PartnerUserService,
    private readonly planService: PartnerPlanService,
    private readonly pricingService: PartnerPricingService,
    private readonly discountService: PartnerDiscountService,
    private readonly referralService: PartnerReferralService,
    private readonly attributionService: PartnerAttributionService,
    private readonly commissionService: PartnerCommissionService,
    private readonly commissionLedger: PartnerCommissionLedgerService,
    private readonly payoutService: PartnerPayoutService,
    private readonly invoiceService: PartnerInvoiceService,
    private readonly settlementService: PartnerSettlementService,
    private readonly usageService: PartnerUsageService,
    private readonly performanceService: PartnerPerformanceService,
    private readonly analyticsService: PartnerAnalyticsService,
    private readonly reconciliationService: PartnerReconciliationService,
    private readonly portalService: PartnerPortalService,
    private readonly auditService: PartnerAuditService,
    private readonly policyService: PartnerPolicyService,
  ) {}

  // --- Partner Profile ---
  @Post()
  async createPartner(@Body() dto: CreatePartnerProfileDto) {
    return this.profileService.createProfile({
      name: dto.name,
      legalName: dto.legalName,
      type: dto.type,
      ownerUserId: dto.ownerUserId,
      contactEmail: dto.contactEmail,
      contactName: dto.contactName,
      website: dto.website,
      countryCode: dto.countryCode,
      taxId: dto.taxId,
      billingEmail: dto.billingEmail,
      currency: dto.currency,
      idempotencyKey: dto.idempotencyKey,
      correlationId: dto.correlationId,
      createdBy: dto.createdBy,
      code: dto.code,
      metadata: dto.metadata,
    });
  }

  @Get()
  async listPartners(@Query() q: PartnerQueryDto) {
    return this.profileService.listProfiles({ state: q.state, type: q.type, ownerUserId: q.ownerUserId });
  }

  @Get(':id')
  async getPartner(@Param('id') id: string) {
    return this.profileService.getProfile(id);
  }

  @Put(':id')
  async updatePartner(@Param('id') id: string, @Body() dto: UpdatePartnerProfileDto) {
    return this.profileService.updateProfile(id, { name: dto.name, legalName: dto.legalName, contactEmail: dto.contactEmail, contactName: dto.contactName, website: dto.website, billingEmail: dto.billingEmail, metadata: dto.metadata }, dto.correlationId, dto.updatedBy);
  }

  @Post(':id/transition')
  async transitionPartner(@Param('id') id: string, @Body() dto: TransitionPartnerStateDto) {
    return this.profileService.transitionState({ partnerId: id, targetState: dto.targetState, correlationId: dto.correlationId, actorId: dto.actorId, actorRole: dto.actorRole, reason: dto.reason });
  }

  // --- Agreements ---
  @Post(':id/agreements')
  async createAgreement(@Param('id') id: string, @Body() dto: CreatePartnerAgreementDto) {
    return this.agreementService.createAgreement({
      partnerId: id,
      commissionPolicy: dto.commissionPolicy,
      pricingRules: dto.pricingRules ?? [],
      payoutTerms: dto.payoutTerms,
      attributionRules: dto.attributionRules ?? [],
      effectiveFrom: dto.effectiveFrom,
      effectiveTo: dto.effectiveTo ?? null,
      jurisdiction: dto.jurisdiction ?? null,
      responsibilities: dto.responsibilities,
      terminationClause: dto.terminationClause ?? null,
      createdBy: dto.createdBy,
      correlationId: dto.correlationId,
    });
  }

  @Get(':id/agreements')
  async listAgreements(@Param('id') id: string) {
    return this.agreementService.listAgreements(id);
  }

  @Get(':id/agreements/active')
  async getActiveAgreement(@Param('id') id: string) {
    const agr = await this.agreementService.getActiveAgreement(id);
    if (!agr) throw new BadRequestException(`no active agreement for partner ${id}`);
    return agr;
  }

  @Post(':id/agreements/:agreementId/transition')
  async transitionAgreement(@Param('id') id: string, @Param('agreementId') agreementId: string, @Body() dto: TransitionAgreementStateDto) {
    return this.agreementService.transitionState({ agreementId, partnerId: id, targetState: dto.targetState, correlationId: dto.correlationId, actorId: dto.actorId, actorRole: dto.actorRole });
  }

  // --- Tenant Relationships ---
  @Post(':id/tenants/assign')
  async assignTenant(@Param('id') id: string, @Body() dto: AssignTenantDto) {
    return this.tenantService.assignTenant({
      partnerId: id,
      tenantId: dto.tenantId,
      relationshipType: dto.relationshipType,
      assignedBy: dto.assignedBy,
      correlationId: dto.correlationId,
      idempotencyKey: dto.idempotencyKey,
      isPrimary: dto.isPrimary,
      campaignId: dto.campaignId,
      referralCode: dto.referralCode,
      attributionId: dto.attributionId,
      metadata: dto.metadata,
    });
  }

  @Post(':id/tenants/transfer')
  async transferTenant(@Param('id') id: string, @Body() dto: TransferTenantDto) {
    return this.tenantService.transferTenant({
      tenantId: dto.tenantId,
      fromPartnerId: dto.fromPartnerId,
      toPartnerId: dto.toPartnerId,
      transferredBy: dto.transferredBy,
      correlationId: dto.correlationId,
      reason: dto.reason,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Post(':id/tenants/:relationshipId/unassign')
  async unassignTenant(@Param('id') id: string, @Param('relationshipId') relationshipId: string, @Body() dto: UnassignTenantDto) {
    return this.tenantService.unassignTenant({ relationshipId, partnerId: id, unassignedBy: dto.unassignedBy, correlationId: dto.correlationId, reason: dto.reason });
  }

  @Get(':id/tenants')
  async listTenants(@Param('id') id: string, @Query() q: PartnerTenantQueryDto) {
    return this.tenantService.listTenantsForPartner(id, { state: q.state, relationshipType: q.relationshipType });
  }

  // --- Partner Users ---
  @Post(':id/users/invite')
  async inviteUser(@Param('id') id: string, @Body() dto: InvitePartnerUserDto) {
    return this.userService.inviteUser({ partnerId: id, userId: dto.userId, role: dto.role, invitedBy: dto.invitedBy, correlationId: dto.correlationId, idempotencyKey: dto.idempotencyKey });
  }

  @Post(':id/users/:userId/activate')
  async activateUser(@Param('id') id: string, @Param('userId') userId: string, @Body() body: { activatedBy: string; correlationId: string }) {
    return this.userService.activateUser({ partnerUserId: userId, partnerId: id, activatedBy: body.activatedBy, correlationId: body.correlationId });
  }

  @Post(':id/users/:userId/suspend')
  async suspendUser(@Param('id') id: string, @Param('userId') userId: string, @Body() body: { suspendedBy: string; correlationId: string; reason: string }) {
    return this.userService.suspendUser({ partnerUserId: userId, partnerId: id, suspendedBy: body.suspendedBy, correlationId: body.correlationId, reason: body.reason });
  }

  @Put(':id/users/:userId/role')
  async changeRole(@Param('id') id: string, @Param('userId') userId: string, @Body() dto: ChangePartnerUserRoleDto) {
    return this.userService.changeRole({ partnerUserId: userId, partnerId: id, newRole: dto.newRole, changedBy: dto.changedBy, correlationId: dto.correlationId });
  }

  @Get(':id/users')
  async listUsers(@Param('id') id: string) {
    return this.userService.listUsersForPartner(id);
  }

  // --- Plans & Pricing ---
  @Get(':id/plans')
  async getEligiblePlans(@Param('id') id: string) {
    return this.planService.getEligiblePlans(id);
  }

  @Post(':id/pricing/resolve')
  async resolvePricing(@Param('id') id: string, @Body() body: { planCode: string; currency?: string; campaignId?: string; discountCode?: string }) {
    if (!body.planCode) throw new BadRequestException('planCode required');
    return this.pricingService.resolveEffectivePrice({ partnerId: id, planCode: body.planCode, currency: body.currency, campaignId: body.campaignId, discountCode: body.discountCode });
  }

  // --- Campaigns & Referrals ---
  @Post(':id/campaigns')
  async createCampaign(@Param('id') id: string, @Body() dto: CreateCampaignDto) {
    return this.discountService.createCampaign({
      partnerId: id,
      name: dto.name,
      code: dto.code,
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      discountCurrency: dto.discountCurrency,
      maxUses: dto.maxUses,
      allowedPlans: dto.allowedPlans,
      attributionWindowHours: dto.attributionWindowHours,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt ?? null,
      createdBy: dto.createdBy,
      correlationId: dto.correlationId,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Get(':id/campaigns')
  async listCampaigns(@Param('id') id: string) {
    return this.discountService.listCampaigns(id);
  }

  @Post(':id/campaigns/:campaignId/activate')
  async activateCampaign(@Param('id') id: string, @Param('campaignId') campaignId: string, @Body() body: { activatedBy: string; correlationId: string }) {
    return this.discountService.activateCampaign({ campaignId, partnerId: id, activatedBy: body.activatedBy, correlationId: body.correlationId });
  }

  @Post(':id/referrals')
  async createReferral(@Param('id') id: string, @Body() dto: CreateReferralDto) {
    return this.referralService.createReferral({ partnerId: id, campaignId: dto.campaignId, code: dto.code, maxUses: dto.maxUses, expiresAt: dto.expiresAt ?? null, createdBy: dto.createdBy, correlationId: dto.correlationId, idempotencyKey: dto.idempotencyKey });
  }

  @Get(':id/referrals')
  async listReferrals(@Param('id') id: string) {
    return this.referralService.listReferrals(id);
  }

  // --- Attribution ---
  @Post(':id/attributions')
  async attributeTenant(@Param('id') id: string, @Body() dto: CreateAttributionDto) {
    return this.attributionService.attributeTenant({
      partnerId: id,
      tenantId: dto.tenantId,
      campaignId: dto.campaignId ?? null,
      referralCode: dto.referralCode ?? null,
      referralToken: dto.referralToken ?? null,
      attributionSource: dto.attributionSource,
      capturedAt: dto.capturedAt,
      agreementVersion: dto.agreementVersion,
      createdBy: dto.createdBy,
      correlationId: dto.correlationId,
      idempotencyKey: dto.idempotencyKey,
      isPrimary: dto.isPrimary,
    });
  }

  @Get(':id/attributions')
  async listAttributions(@Param('id') id: string) {
    return this.attributionService.listAttributionsForPartner(id);
  }

  // --- Commissions ---
  @Post(':id/commissions/calculate')
  async calculateCommission(@Param('id') id: string, @Body() dto: CalculateCommissionDto) {
    const calc = await this.commissionService.calculateCommission({
      partnerId: id,
      tenantId: dto.tenantId,
      sourcePaymentId: dto.sourcePaymentId ?? null,
      sourceInvoiceId: dto.sourceInvoiceId ?? null,
      sourceSubscriptionId: dto.sourceSubscriptionId ?? null,
      sourceFeeId: dto.sourceFeeId ?? null,
      sourceEventId: dto.sourceEventId,
      sourceEventType: dto.sourceEventType,
      grossRevenue: dto.grossRevenue,
      discountAmount: dto.discountAmount,
      currency: dto.currency,
      sourceCurrency: dto.sourceCurrency,
      correlationId: dto.correlationId,
      idempotencyKey: dto.idempotencyKey,
      createdBy: dto.createdBy,
      isTrial: dto.isTrial,
      isLifetime: dto.isLifetime,
      isFirstPeriod: dto.isFirstPeriod,
      periodNumber: dto.periodNumber,
      planCode: dto.planCode,
      paymentStatus: dto.paymentStatus,
      invoiceStatus: dto.invoiceStatus,
    });
    if (!calc) throw new BadRequestException('commission not eligible - no active agreement, attribution, or invalid source status');
    return this.commissionLedger.accrueCommission(calc, dto.createdBy);
  }

  @Post(':id/commissions/:commissionId/reverse')
  async reverseCommission(@Param('id') id: string, @Param('commissionId') commissionId: string, @Body() dto: ReverseCommissionDto) {
    return this.commissionLedger.reverseCommission({
      originalCommissionId: commissionId,
      partnerId: id,
      tenantId: dto.tenantId,
      reversalReason: dto.reversalReason,
      reversalType: dto.reversalType,
      reversalAmount: dto.reversalAmount,
      correlationId: dto.correlationId,
      actorId: dto.actorId,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Get(':id/commissions')
  async listCommissions(@Param('id') id: string, @Query() q: PartnerCommissionQueryDto) {
    return this.commissionLedger.listCommissions(id, { tenantId: q.tenantId, state: q.state, settlementId: q.settlementId, currency: q.currency });
  }

  // --- Settlements ---
  @Post(':id/settlements')
  async createSettlement(@Param('id') id: string, @Body() dto: CreateSettlementDto) {
    return this.settlementService.createSettlement({
      partnerId: id,
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
      currency: dto.currency,
      createdBy: dto.createdBy,
      correlationId: dto.correlationId,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Get(':id/settlements')
  async listSettlements(@Param('id') id: string, @Query() q: PartnerSettlementQueryDto) {
    return this.settlementService.listSettlements(id, { state: q.state, currency: q.currency });
  }

  @Get(':id/settlements/:settlementId')
  async getSettlement(@Param('id') id: string, @Param('settlementId') settlementId: string) {
    return this.settlementService.getSettlement(settlementId, id);
  }

  @Post(':id/settlements/:settlementId/transition')
  async transitionSettlement(@Param('id') id: string, @Param('settlementId') settlementId: string, @Body() body: { targetState: any; correlationId: string; actorId: string }) {
    return this.settlementService.transitionState({ settlementId, partnerId: id, targetState: body.targetState, correlationId: body.correlationId, actorId: body.actorId });
  }

  // --- Payouts ---
  @Post(':id/payouts')
  async requestPayout(@Param('id') id: string, @Body() dto: RequestPayoutDto) {
    return this.payoutService.requestPayout({
      partnerId: id,
      settlementId: dto.settlementId,
      amount: dto.amount,
      currency: dto.currency,
      method: dto.method,
      requestedBy: dto.requestedBy,
      correlationId: dto.correlationId,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Get(':id/payouts')
  async listPayouts(@Param('id') id: string, @Query() q: PartnerPayoutQueryDto) {
    return this.payoutService.listPayouts(id, { settlementId: q.settlementId, state: q.state });
  }

  @Post(':id/payouts/:payoutId/transition')
  async transitionPayout(@Param('id') id: string, @Param('payoutId') payoutId: string, @Body() dto: TransitionPayoutDto) {
    return this.payoutService.transitionState({
      payoutId,
      partnerId: id,
      targetState: dto.targetState as any,
      correlationId: dto.correlationId,
      actorId: dto.actorId,
      providerPayoutId: dto.providerPayoutId,
      providerReference: dto.providerReference,
      failureReason: dto.failureReason,
    });
  }

  // --- Invoices ---
  @Get(':id/invoices')
  async listInvoices(@Param('id') id: string, @Query('currency') currency: string) {
    return this.invoiceService.listStatements(id, { currency });
  }

  @Post(':id/invoices/generate')
  async generateInvoice(@Param('id') id: string, @Body() body: { periodStart: string; periodEnd: string; currency: string; settlementId?: string; correlationId: string }) {
    return this.invoiceService.generateStatement({
      partnerId: id,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      currency: body.currency,
      settlementId: body.settlementId,
      correlationId: body.correlationId,
    });
  }

  // --- Usage, Performance, Analytics ---
  @Get(':id/usage')
  async getUsage(@Param('id') id: string, @Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string, @Query('correlationId') correlationId: string) {
    if (!periodStart || !periodEnd) throw new BadRequestException('periodStart and periodEnd required');
    return this.usageService.aggregateUsage({ partnerId: id, periodStart, periodEnd, correlationId: correlationId ?? `corr_${Date.now()}` });
  }

  @Get(':id/performance')
  async getPerformance(@Param('id') id: string, @Query() q: PartnerAnalyticsQueryDto) {
    return this.performanceService.calculatePerformance({
      partnerId: id,
      periodStart: q.periodStart,
      periodEnd: q.periodEnd,
      currency: q.currency,
      correlationId: q.correlationId ?? `corr_${Date.now()}`,
    });
  }

  @Get(':id/analytics')
  async getAnalytics(@Param('id') id: string, @Query() q: PartnerAnalyticsQueryDto) {
    return this.analyticsService.getAnalytics({
      partnerId: id,
      granularity: q.granularity,
      periodStart: q.periodStart,
      periodEnd: q.periodEnd,
      currency: q.currency,
      correlationId: q.correlationId ?? `corr_${Date.now()}`,
    });
  }

  // --- Reconciliation & Audit ---
  @Post(':id/reconciliation')
  async reconcile(@Param('id') id: string, @Body() body: { correlationId: string }) {
    return this.reconciliationService.reconcilePartner(id, body.correlationId ?? `corr_${Date.now()}`);
  }

  @Get(':id/reconciliation/mismatches')
  async listMismatches(@Param('id') id: string, @Query() q: ReconciliationQueryDto) {
    return this.reconciliationService.listMismatches(id, { type: q.type as any, severity: q.severity });
  }

  @Get(':id/audit')
  async listAudit(@Param('id') id: string, @Query('take') take: string) {
    return this.auditService.listEvents(id, { take: take ? parseInt(take, 10) : 100 });
  }

  // --- Portal ---
  @Get(':id/portal')
  async getPortal(@Param('id') id: string, @Query() q: PartnerPortalQueryDto) {
    return this.portalService.getPortalData({
      partnerId: id,
      userId: q.userId,
      correlationId: q.correlationId ?? `corr_${Date.now()}`,
      currency: q.currency,
      periodStart: q.periodStart,
      periodEnd: q.periodEnd,
    });
  }

  @Get(':id/policy')
  async getPolicy(@Param('id') id: string) {
    const profile = await this.profileService.getProfile(id);
    const agreement = await this.agreementService.getActiveAgreement(id);
    if (!agreement) throw new BadRequestException('no active agreement');
    return agreement.commissionPolicy;
  }
}
