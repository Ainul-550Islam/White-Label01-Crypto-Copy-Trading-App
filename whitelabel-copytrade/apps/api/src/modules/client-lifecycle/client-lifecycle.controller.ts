import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Req,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ClientProfileService } from './client-profile.service';
import { ClientProfileRepository } from './client-profile.repository';
import { ClientOnboardingService } from './client-onboarding.service';
import { OnboardingWorkflowService } from './onboarding-workflow.service';
import { AccountAdministrationService } from './account-administration.service';
import { AccountStateService } from './account-state.service';
import { AccountOwnershipService } from './account-ownership.service';
import { AccountPermissionService, ClientVisibilityRole } from './account-permission.service';
import { TradingActivationService } from './trading-activation.service';
import { AccountRestrictionService } from './account-restriction.service';
import { AccountSuspensionService } from './account-suspension.service';
import { AccountClosureService } from './account-closure.service';
import { ExchangeAccountBindingService } from './exchange-account-binding.service';
import { PortfolioBindingService } from './portfolio-binding.service';
import { FundingRequestService } from './funding-request.service';
import { WithdrawalRequestService } from './withdrawal-request.service';
import { FundingApprovalService } from './funding-approval.service';
import { FundingReconciliationService } from './funding-reconciliation.service';
import { AccountReviewService } from './account-review.service';
import { RelationshipService } from './relationship.service';
import { LifecycleNotificationService } from './lifecycle-notification.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { LifecycleReconciliationService } from './lifecycle-reconciliation.service';
import { ClientVisibilityService } from './client-visibility.service';
import { CreateClientProfileDto, UpdateClientProfileDto, CreateInstitutionalAccountDto } from './dto/client-profile.dto';
import {
  ActivateAccountDto,
  RestrictAccountDto,
  SuspendAccountDto,
  RestoreAccountDto,
  CloseAccountDto,
  CancelClosureDto,
  BindExchangeAccountDto,
  UnbindExchangeAccountDto,
  BindPortfolioDto,
  UnbindPortfolioDto,
  CreateOwnershipDto,
  CreateRelationshipDto,
  CreateReviewDto,
  DecideReviewDto,
} from './dto/account-action.dto';
import {
  CreateFundingRequestDto,
  CreateWithdrawalRequestDto,
  TransitionFundingRequestDto,
  TransitionWithdrawalRequestDto,
  ApproveFundingDto,
  RejectFundingDto,
  ReconciliationRequestDto,
} from './dto/funding-request.dto';
import {
  ClientProfileQueryDto,
  InstitutionalAccountQueryDto,
  FundingRequestQueryDto,
  WithdrawalRequestQueryDto,
  RelationshipQueryDto,
  RestrictionQueryDto,
  ReviewQueryDto,
  LifecycleAuditQueryDto,
  OnboardingQueryDto,
} from './dto/client-query.dto';
import { redactPiiAndSecrets, ClientProfileStatus, InstitutionalAccountState, FundingRequestState, WithdrawalRequestState } from './client-lifecycle.types';

/**
 * Tenant-safe and platform-safe API surface exposing client profiles, onboarding, accounts,
 * ownership, restrictions, reviews, funding workflows, withdrawal workflows, lifecycle status,
 * and controlled actions. Enforce existing RBAC, ownership, compliance visibility, and tenant isolation.
 */

@Controller('client-lifecycle')
export class ClientLifecycleController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profileService: ClientProfileService,
    private readonly profileRepo: ClientProfileRepository,
    private readonly onboardingService: ClientOnboardingService,
    private readonly workflowService: OnboardingWorkflowService,
    private readonly accountAdminService: AccountAdministrationService,
    private readonly accountStateService: AccountStateService,
    private readonly ownershipService: AccountOwnershipService,
    private readonly permissionService: AccountPermissionService,
    private readonly tradingActivationService: TradingActivationService,
    private readonly restrictionService: AccountRestrictionService,
    private readonly suspensionService: AccountSuspensionService,
    private readonly closureService: AccountClosureService,
    private readonly exchangeBindingService: ExchangeAccountBindingService,
    private readonly portfolioBindingService: PortfolioBindingService,
    private readonly fundingRequestService: FundingRequestService,
    private readonly withdrawalRequestService: WithdrawalRequestService,
    private readonly fundingApprovalService: FundingApprovalService,
    private readonly fundingReconciliationService: FundingReconciliationService,
    private readonly reviewService: AccountReviewService,
    private readonly relationshipService: RelationshipService,
    private readonly notificationService: LifecycleNotificationService,
    private readonly auditService: LifecycleAuditService,
    private readonly reconciliationService: LifecycleReconciliationService,
    private readonly visibilityService: ClientVisibilityService,
  ) {}

  private getTenantId(req: any): string {
    const tenantId = req.user?.tenantId ?? req.headers['x-tenant-id'] ?? req.query?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId required');
    return tenantId;
  }

  private getUserId(req: any): string {
    return req.user?.id ?? req.user?.sub ?? 'anonymous';
  }

  private getUserRole(req: any): ClientVisibilityRole {
    return (req.user?.clientRole as ClientVisibilityRole) ?? (req.user?.role as ClientVisibilityRole) ?? ClientVisibilityRole.CLIENT;
  }

  private isPlatformUser(req: any): boolean {
    return req.user?.isPlatformUser ?? (req.user?.role === 'PLATFORM_ADMIN');
  }

  private isSelfApproval(req: any, targetUserId?: string): boolean {
    const userId = this.getUserId(req);
    if (!targetUserId) return false;
    return userId === targetUserId;
  }

  private async enforceTenantIsolationForProfile(tenantId: string, profileId: string): Promise<void> {
    const profile = await this.profileRepo.getProfile({ tenantId, profileId });
    if (!profile) throw new BadRequestException('Client profile not found or tenant mismatch');
    if (profile.tenantId !== tenantId) throw new ForbiddenException('Tenant isolation: profile belongs to different tenant');
  }

  private async enforceTenantIsolationForAccount(tenantId: string, accountId: string): Promise<void> {
    const account = await this.accountAdminService.getAccount({ tenantId, accountId });
    if (!account) throw new BadRequestException('Account not found or tenant mismatch');
    if (account.tenantId !== tenantId) throw new ForbiddenException('Tenant isolation: account belongs to different tenant');
  }

  private async enforcePlatformRBAC(req: any, requiredPermission?: string): Promise<void> {
    if (requiredPermission && this.isPlatformUser(req)) {
      // Platform RBAC check — reuse existing RBAC if available
      return;
    }
    // For platform-level client/account administration requires existing platform RBAC
    if (requiredPermission === 'PLATFORM_MANAGE' && !this.isPlatformUser(req)) {
      // Allow tenant owner for some operations, but platform-only for others
      const role = this.getUserRole(req);
      if (role !== ClientVisibilityRole.TENANT_OWNER && role !== ClientVisibilityRole.PLATFORM_ADMIN) {
        throw new ForbiddenException('Platform operation requires platform RBAC');
      }
    }
  }

  // Client Profiles
  @Post('clients')
  async createClient(@Req() req: any, @Body() dto: CreateClientProfileDto) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);

    const profile = await this.profileService.createProfile({
      tenantId,
      clientType: dto.clientType,
      legalName: dto.legalName,
      displayName: dto.displayName,
      email: dto.email,
      phone: dto.phone,
      countryCode: dto.countryCode,
      externalIdentityRef: dto.externalIdentityRef,
      operatorId: userId,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(profile);
  }

  @Get('clients')
  async listClients(@Req() req: any, @Query() query: ClientProfileQueryDto) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    const role = this.getUserRole(req);
    const isPlatform = this.isPlatformUser(req);

    const result = await this.profileService.listProfiles({
      tenantId,
      status: query.status,
      clientType: query.clientType,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });

    // Visibility enforcement — client must never be able to view another client's profile
    if (!isPlatform && role === ClientVisibilityRole.CLIENT) {
      const visible = await this.visibilityService.resolveVisibleClientProfiles({ tenantId, userId, role, isPlatformUser: isPlatform });
      const visibleIds = new Set(visible.map((v) => v.clientProfileId));
      result.data = result.data.filter((p: any) => visibleIds.has(p.id));
    }

    return { ...result, data: result.data.map((d: any) => redactPiiAndSecrets(d)) };
  }

  @Get('clients/:profileId')
  async getClient(@Req() req: any, @Param('profileId') profileId: string) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    const role = this.getUserRole(req);
    const isPlatform = this.isPlatformUser(req);

    await this.enforceTenantIsolationForProfile(tenantId, profileId);

    const canView = await this.visibilityService.canViewClientProfile({ tenantId, userId, clientProfileId: profileId, role, isPlatformUser: isPlatform });
    if (!canView && !isPlatform && role !== ClientVisibilityRole.TENANT_OWNER && role !== ClientVisibilityRole.COMPLIANCE_REVIEWER && role !== ClientVisibilityRole.SECURITY_ADMIN) {
      throw new ForbiddenException('Access denied to client profile');
    }

    const profile = await this.profileService.getProfile({ tenantId, profileId });
    return redactPiiAndSecrets(profile);
  }

  // Onboarding
  @Post('clients/:profileId/onboarding')
  async initiateOnboarding(@Req() req: any, @Param('profileId') profileId: string) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForProfile(tenantId, profileId);

    const onboarding = await this.onboardingService.initiateOnboarding({
      tenantId,
      clientProfileId: profileId,
      operatorId: this.getUserId(req),
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    await this.notificationService.notifyOnboardingStarted({ tenantId, clientProfileId: profileId, onboardingId: onboarding.id });

    return redactPiiAndSecrets(onboarding);
  }

  @Get('onboarding/:onboardingId')
  async getOnboarding(@Req() req: any, @Param('onboardingId') onboardingId: string) {
    const tenantId = this.getTenantId(req);
    const onboarding = await this.onboardingService.getOnboarding({ tenantId, onboardingId });
    if (!onboarding) throw new BadRequestException('Onboarding not found');
    await this.enforceTenantIsolationForProfile(tenantId, onboarding.clientProfileId);
    return redactPiiAndSecrets(onboarding);
  }

  @Get('clients/:profileId/onboarding')
  async getOnboardingByClient(@Req() req: any, @Param('profileId') profileId: string) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForProfile(tenantId, profileId);
    const onboarding = await this.onboardingService.getOnboardingByClientProfile({ tenantId, clientProfileId: profileId });
    return onboarding ? redactPiiAndSecrets(onboarding) : null;
  }

  @Post('onboarding/:onboardingId/approve')
  async approveOnboarding(@Req() req: any, @Param('onboardingId') onboardingId: string) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    const role = this.getUserRole(req);

    // Never allow a client to self-approve a privileged workflow
    const isSelf = role === ClientVisibilityRole.CLIENT;
    if (isSelf) throw new ForbiddenException('Client cannot self-approve onboarding');

    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const approved = await this.onboardingService.approveOnboarding({
      tenantId,
      onboardingId,
      operatorId: userId,
      isSelfApproval: isSelf,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    const onboarding = await this.onboardingService.getOnboarding({ tenantId, onboardingId });
    if (onboarding) {
      await this.notificationService.notifyOnboardingApproved({ tenantId, clientProfileId: onboarding.clientProfileId, onboardingId });
    }

    return redactPiiAndSecrets(approved);
  }

  @Post('onboarding/:onboardingId/reject')
  async rejectOnboarding(@Req() req: any, @Param('onboardingId') onboardingId: string, @Body() body: { reason: string }) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);

    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const rejected = await this.onboardingService.rejectOnboarding({
      tenantId,
      onboardingId,
      operatorId: userId,
      reason: body.reason,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(rejected);
  }

  @Get('onboarding')
  async listOnboardings(@Req() req: any, @Query() query: OnboardingQueryDto) {
    const tenantId = this.getTenantId(req);
    const where: any = { tenantId };
    if (query.clientProfileId) where.clientProfileId = query.clientProfileId;
    if (query.state) where.state = query.state;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).clientOnboarding.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: ((query.page ?? 1) - 1) * (query.limit ?? 50),
          take: query.limit ?? 50,
        }),
        (this.prisma as any).clientOnboarding.count({ where }),
      ]);
      return { data: data.map((d: any) => redactPiiAndSecrets(d)), total, page: query.page ?? 1, limit: query.limit ?? 50 };
    } catch {
      return { data: [], total: 0, page: query.page ?? 1, limit: query.limit ?? 50 };
    }
  }

  // Institutional Accounts
  @Post('accounts')
  async createAccount(@Req() req: any, @Body() dto: CreateInstitutionalAccountDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForProfile(tenantId, dto.clientProfileId);

    const account = await this.accountAdminService.createAccount({
      tenantId,
      clientProfileId: dto.clientProfileId,
      accountType: dto.accountType,
      displayName: dto.displayName,
      ownerId: dto.ownerId,
      ownerType: dto.ownerType,
      operatorId: this.getUserId(req),
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(account);
  }

  @Get('accounts')
  async listAccounts(@Req() req: any, @Query() query: InstitutionalAccountQueryDto) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    const role = this.getUserRole(req);
    const isPlatform = this.isPlatformUser(req);

    const result = await this.accountAdminService.listAccounts({
      tenantId,
      clientProfileId: query.clientProfileId,
      state: query.state,
      accountType: query.accountType,
      ownerId: query.ownerId,
      page: query.page,
      limit: query.limit,
    });

    if (!isPlatform && role === ClientVisibilityRole.CLIENT) {
      const visibleProfiles = await this.visibilityService.resolveVisibleClientProfiles({ tenantId, userId, role, isPlatformUser: isPlatform });
      const visibleIds = new Set(visibleProfiles.map((v) => v.clientProfileId));
      result.data = result.data.filter((a: any) => visibleIds.has(a.clientProfileId));
    }

    return { ...result, data: result.data.map((d: any) => redactPiiAndSecrets(d)) };
  }

  @Get('accounts/:accountId')
  async getAccount(@Req() req: any, @Param('accountId') accountId: string) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    const role = this.getUserRole(req);
    const isPlatform = this.isPlatformUser(req);

    await this.enforceTenantIsolationForAccount(tenantId, accountId);

    const canView = await this.visibilityService.canViewAccount({ tenantId, userId, accountId, role, isPlatformUser: isPlatform });
    if (!canView && !isPlatform && role !== ClientVisibilityRole.TENANT_OWNER && role !== ClientVisibilityRole.COMPLIANCE_REVIEWER && role !== ClientVisibilityRole.SECURITY_ADMIN) {
      throw new ForbiddenException('Access denied to account');
    }

    const account = await this.accountAdminService.getAccount({ tenantId, accountId });
    return redactPiiAndSecrets(account);
  }

  @Post('accounts/activate')
  async activateAccount(@Req() req: any, @Body() dto: ActivateAccountDto) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    await this.enforceTenantIsolationForAccount(tenantId, dto.accountId);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    // Evaluate trading activation prerequisites
    const eligibility = await this.tradingActivationService.evaluateEligibility({ tenantId, accountId: dto.accountId });

    if (!eligibility.isEligible) {
      throw new BadRequestException(`Account not eligible for activation: ${eligibility.blockingEvidence.filter((e) => !e.passed).map((e) => `${e.check}: ${e.reason}`).join(', ')}`);
    }

    const activated = await this.accountStateService.transitionAccount({
      tenantId,
      accountId: dto.accountId,
      toState: InstitutionalAccountState.ACTIVE as any,
      operatorId: userId,
      reason: 'Trading activation eligibility passed',
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(activated);
  }

  @Get('accounts/:accountId/eligibility')
  async getEligibility(@Req() req: any, @Param('accountId') accountId: string) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForAccount(tenantId, accountId);

    const eligibility = await this.tradingActivationService.evaluateEligibility({ tenantId, accountId });
    return redactPiiAndSecrets(eligibility);
  }

  // Restrictions
  @Post('accounts/restrict')
  async restrictAccount(@Req() req: any, @Body() dto: RestrictAccountDto) {
    const tenantId = this.getTenantId(req);
    if (dto.accountId) await this.enforceTenantIsolationForAccount(tenantId, dto.accountId);
    if (dto.clientProfileId) await this.enforceTenantIsolationForProfile(tenantId, dto.clientProfileId);

    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const restriction = await this.restrictionService.applyRestriction({
      tenantId,
      accountId: dto.accountId ?? null,
      clientProfileId: dto.clientProfileId ?? null,
      restrictionType: dto.restrictionType as any,
      scope: dto.scope as any,
      reason: dto.reason,
      source: dto.source,
      createdBy: this.getUserId(req),
      effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : new Date(),
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    await this.notificationService.notifyRestrictionApplied({
      tenantId,
      accountId: dto.accountId ?? null,
      clientProfileId: dto.clientProfileId ?? null,
      restrictionType: dto.restrictionType,
      reason: dto.reason,
    });

    return redactPiiAndSecrets(restriction);
  }

  @Post('restrictions/:restrictionId/revoke')
  async revokeRestriction(@Req() req: any, @Param('restrictionId') restrictionId: string, @Body() body: { reason?: string }) {
    const tenantId = this.getTenantId(req);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const revoked = await this.restrictionService.revokeRestriction({
      tenantId,
      restrictionId,
      revokedBy: this.getUserId(req),
      reason: body.reason,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(revoked);
  }

  @Get('restrictions')
  async listRestrictions(@Req() req: any, @Query() query: RestrictionQueryDto) {
    const tenantId = this.getTenantId(req);
    if (query.accountId) await this.enforceTenantIsolationForAccount(tenantId, query.accountId);
    if (query.clientProfileId) await this.enforceTenantIsolationForProfile(tenantId, query.clientProfileId);

    return await this.restrictionService.listRestrictions({
      tenantId,
      accountId: query.accountId,
      clientProfileId: query.clientProfileId,
      restrictionType: query.restrictionType,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  // Suspension
  @Post('accounts/suspend')
  async suspendAccount(@Req() req: any, @Body() dto: SuspendAccountDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForAccount(tenantId, dto.accountId);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const suspended = await this.suspensionService.suspendAccount({
      tenantId,
      accountId: dto.accountId,
      reason: dto.reason,
      reasonCode: dto.reasonCode,
      source: dto.source,
      operatorId: this.getUserId(req),
      effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : new Date(),
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    await this.notificationService.notifySuspension({ tenantId, accountId: dto.accountId, reason: dto.reason });

    return redactPiiAndSecrets(suspended);
  }

  @Post('accounts/restore')
  async restoreAccount(@Req() req: any, @Body() dto: RestoreAccountDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForAccount(tenantId, dto.accountId);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const restored = await this.suspensionService.restoreAccount({
      tenantId,
      accountId: dto.accountId,
      reason: dto.reason,
      operatorId: this.getUserId(req),
      verificationEvidence: dto.verificationEvidence,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(restored);
  }

  // Closure
  @Post('accounts/close/initiate')
  async initiateClosure(@Req() req: any, @Body() dto: CloseAccountDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForAccount(tenantId, dto.accountId);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const pending = await this.closureService.initiateClosure({
      tenantId,
      accountId: dto.accountId,
      operatorId: this.getUserId(req),
      reason: dto.reason,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(pending);
  }

  @Post('accounts/close/confirm')
  async confirmClosure(@Req() req: any, @Body() dto: CloseAccountDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForAccount(tenantId, dto.accountId);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const closed = await this.closureService.validateAndClose({
      tenantId,
      accountId: dto.accountId,
      operatorId: this.getUserId(req),
      reason: dto.reason,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    await this.notificationService.notifyAccountClosed({ tenantId, accountId: dto.accountId, reason: dto.reason });

    return redactPiiAndSecrets(closed);
  }

  @Post('accounts/close/cancel')
  async cancelClosure(@Req() req: any, @Body() dto: CancelClosureDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForAccount(tenantId, dto.accountId);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const restored = await this.closureService.cancelClosure({
      tenantId,
      accountId: dto.accountId,
      operatorId: this.getUserId(req),
      reason: dto.reason,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(restored);
  }

  // Exchange binding
  @Post('accounts/bind-exchange')
  async bindExchange(@Req() req: any, @Body() dto: BindExchangeAccountDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForAccount(tenantId, dto.accountId);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const result = await this.exchangeBindingService.bindExchangeAccount({
      tenantId,
      accountId: dto.accountId,
      exchangeAccountId: dto.exchangeAccountId,
      operatorId: this.getUserId(req),
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(result);
  }

  @Post('accounts/unbind-exchange')
  async unbindExchange(@Req() req: any, @Body() dto: UnbindExchangeAccountDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForAccount(tenantId, dto.accountId);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const result = await this.exchangeBindingService.unbindExchangeAccount({
      tenantId,
      accountId: dto.accountId,
      operatorId: this.getUserId(req),
      reason: dto.reason,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(result);
  }

  // Portfolio binding
  @Post('accounts/bind-portfolio')
  async bindPortfolio(@Req() req: any, @Body() dto: BindPortfolioDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForAccount(tenantId, dto.accountId);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const result = await this.portfolioBindingService.bindPortfolio({
      tenantId,
      accountId: dto.accountId,
      portfolioId: dto.portfolioId,
      operatorId: this.getUserId(req),
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(result);
  }

  @Post('accounts/unbind-portfolio')
  async unbindPortfolio(@Req() req: any, @Body() dto: UnbindPortfolioDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForAccount(tenantId, dto.accountId);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const result = await this.portfolioBindingService.unbindPortfolio({
      tenantId,
      accountId: dto.accountId,
      operatorId: this.getUserId(req),
      reason: dto.reason,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(result);
  }

  // Ownership
  @Post('accounts/ownership')
  async createOwnership(@Req() req: any, @Body() dto: CreateOwnershipDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForAccount(tenantId, dto.accountId);
    if (dto.clientProfileId) await this.enforceTenantIsolationForProfile(tenantId, dto.clientProfileId);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const ownership = await this.ownershipService.createOwnership({
      tenantId,
      accountId: dto.accountId,
      clientProfileId: dto.clientProfileId ?? null,
      ownerId: dto.ownerId,
      ownerType: dto.ownerType,
      ownershipType: dto.ownershipType as any,
      createdBy: this.getUserId(req),
      source: dto.source,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(ownership);
  }

  @Get('accounts/:accountId/ownership')
  async listOwnerships(@Req() req: any, @Param('accountId') accountId: string, @Query() query: any) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForAccount(tenantId, accountId);

    return await this.ownershipService.listOwnerships({
      tenantId,
      accountId,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  // Relationships
  @Post('relationships')
  async createRelationship(@Req() req: any, @Body() dto: CreateRelationshipDto) {
    const tenantId = this.getTenantId(req);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const relationship = await this.relationshipService.createRelationship({
      tenantId,
      sourceId: dto.sourceId,
      sourceType: dto.sourceType,
      targetId: dto.targetId,
      targetType: dto.targetType,
      relationshipType: dto.relationshipType as any,
      clientProfileId: dto.clientProfileId ?? null,
      accountId: dto.accountId ?? null,
      createdBy: this.getUserId(req),
      source: dto.source,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(relationship);
  }

  @Get('relationships')
  async listRelationships(@Req() req: any, @Query() query: RelationshipQueryDto) {
    const tenantId = this.getTenantId(req);
    return await this.relationshipService.listRelationships({
      tenantId,
      sourceId: query.sourceId,
      targetId: query.targetId,
      relationshipType: query.relationshipType,
      clientProfileId: query.clientProfileId,
      accountId: query.accountId,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  // Funding
  @Post('funding')
  async createFunding(@Req() req: any, @Body() dto: CreateFundingRequestDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForAccount(tenantId, dto.accountId);

    const funding = await this.fundingRequestService.createFundingRequest({
      tenantId,
      accountId: dto.accountId,
      clientProfileId: dto.clientProfileId ?? null,
      requestedAmount: dto.requestedAmount,
      currency: dto.currency,
      externalReference: dto.externalReference ?? null,
      sourceType: dto.sourceType ?? null,
      requestedBy: this.getUserId(req),
      correlationId: req.headers['x-correlation-id'] ?? null,
      metadata: dto.metadata,
    });

    await this.notificationService.notifyFundingRequested({
      tenantId,
      accountId: dto.accountId,
      fundingRequestId: funding.id,
      amount: dto.requestedAmount,
      currency: dto.currency,
    });

    return redactPiiAndSecrets(funding);
  }

  @Get('funding')
  async listFunding(@Req() req: any, @Query() query: FundingRequestQueryDto) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    const role = this.getUserRole(req);
    const isPlatform = this.isPlatformUser(req);

    if (query.accountId) await this.enforceTenantIsolationForAccount(tenantId, query.accountId);
    if (query.clientProfileId) await this.enforceTenantIsolationForProfile(tenantId, query.clientProfileId);

    const result = await this.fundingRequestService.listFundingRequests({
      tenantId,
      accountId: query.accountId,
      clientProfileId: query.clientProfileId,
      state: query.state,
      currency: query.currency,
      externalReference: query.externalReference,
      page: query.page,
      limit: query.limit,
    });

    // Client cannot access another client's funding data
    if (!isPlatform && role === ClientVisibilityRole.CLIENT) {
      const visibleProfiles = await this.visibilityService.resolveVisibleClientProfiles({ tenantId, userId, role, isPlatformUser: isPlatform });
      const visibleIds = new Set(visibleProfiles.map((v) => v.clientProfileId));
      result.data = result.data.filter((f: any) => visibleIds.has(f.clientProfileId));
    }

    return { ...result, data: result.data.map((d: any) => redactPiiAndSecrets(d)) };
  }

  @Post('funding/transition')
  async transitionFunding(@Req() req: any, @Body() dto: TransitionFundingRequestDto) {
    const tenantId = this.getTenantId(req);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const updated = await this.fundingRequestService.transitionFundingRequest({
      tenantId,
      fundingRequestId: dto.fundingRequestId,
      toState: dto.toState as any,
      operatorId: this.getUserId(req),
      reason: dto.reason,
      approvedAmount: dto.approvedAmount ?? null,
      submittedAmount: dto.submittedAmount ?? null,
      confirmedAmount: dto.confirmedAmount ?? null,
      settledAmount: dto.settledAmount ?? null,
      externalReference: dto.externalReference ?? null,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    if (dto.toState === 'CONFIRMED') {
      await this.notificationService.notifyFundingConfirmed({
        tenantId,
        accountId: updated.accountId,
        fundingRequestId: updated.id,
        confirmedAmount: dto.confirmedAmount ?? updated.confirmedAmount ?? updated.requestedAmount,
        currency: updated.currency,
      });
    }

    return redactPiiAndSecrets(updated);
  }

  // Withdrawals
  @Post('withdrawals')
  async createWithdrawal(@Req() req: any, @Body() dto: CreateWithdrawalRequestDto) {
    const tenantId = this.getTenantId(req);
    await this.enforceTenantIsolationForAccount(tenantId, dto.accountId);

    const withdrawal = await this.withdrawalRequestService.createWithdrawalRequest({
      tenantId,
      accountId: dto.accountId,
      clientProfileId: dto.clientProfileId ?? null,
      requestedAmount: dto.requestedAmount,
      currency: dto.currency,
      destinationAddress: dto.destinationAddress ?? null,
      destinationType: dto.destinationType ?? null,
      externalReference: dto.externalReference ?? null,
      requestedBy: this.getUserId(req),
      correlationId: req.headers['x-correlation-id'] ?? null,
      metadata: dto.metadata,
    });

    await this.notificationService.notifyWithdrawalRequested({
      tenantId,
      accountId: dto.accountId,
      withdrawalRequestId: withdrawal.id,
      amount: dto.requestedAmount,
      currency: dto.currency,
    });

    return redactPiiAndSecrets(withdrawal);
  }

  @Get('withdrawals')
  async listWithdrawals(@Req() req: any, @Query() query: WithdrawalRequestQueryDto) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    const role = this.getUserRole(req);
    const isPlatform = this.isPlatformUser(req);

    if (query.accountId) await this.enforceTenantIsolationForAccount(tenantId, query.accountId);
    if (query.clientProfileId) await this.enforceTenantIsolationForProfile(tenantId, query.clientProfileId);

    const result = await this.withdrawalRequestService.listWithdrawalRequests({
      tenantId,
      accountId: query.accountId,
      clientProfileId: query.clientProfileId,
      state: query.state,
      currency: query.currency,
      page: query.page,
      limit: query.limit,
    });

    if (!isPlatform && role === ClientVisibilityRole.CLIENT) {
      const visibleProfiles = await this.visibilityService.resolveVisibleClientProfiles({ tenantId, userId, role, isPlatformUser: isPlatform });
      const visibleIds = new Set(visibleProfiles.map((v) => v.clientProfileId));
      result.data = result.data.filter((w: any) => visibleIds.has(w.clientProfileId));
    }

    return { ...result, data: result.data.map((d: any) => redactPiiAndSecrets(d)) };
  }

  @Post('withdrawals/transition')
  async transitionWithdrawal(@Req() req: any, @Body() dto: TransitionWithdrawalRequestDto) {
    const tenantId = this.getTenantId(req);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const updated = await this.withdrawalRequestService.transitionWithdrawalRequest({
      tenantId,
      withdrawalRequestId: dto.withdrawalRequestId,
      toState: dto.toState as any,
      operatorId: this.getUserId(req),
      reason: dto.reason,
      approvedAmount: dto.approvedAmount ?? null,
      confirmedAmount: dto.confirmedAmount ?? null,
      externalReference: dto.externalReference ?? null,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(updated);
  }

  // Approvals
  @Post('funding/approve')
  async approveFunding(@Req() req: any, @Body() dto: ApproveFundingDto) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    const role = this.getUserRole(req);
    const isSelf = role === ClientVisibilityRole.CLIENT;

    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const approval = await this.fundingApprovalService.approveFundingRequest({
      tenantId,
      fundingRequestId: dto.fundingRequestId ?? null,
      withdrawalRequestId: dto.withdrawalRequestId ?? null,
      approverId: userId,
      isSelfApproval: isSelf,
      reason: dto.reason,
      approvedAmount: dto.approvedAmount ?? null,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(approval);
  }

  @Post('funding/reject')
  async rejectFunding(@Req() req: any, @Body() dto: RejectFundingDto) {
    const tenantId = this.getTenantId(req);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const rejection = await this.fundingApprovalService.rejectFundingRequest({
      tenantId,
      fundingRequestId: dto.fundingRequestId ?? null,
      withdrawalRequestId: dto.withdrawalRequestId ?? null,
      approverId: this.getUserId(req),
      reason: dto.reason,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(rejection);
  }

  // Reconciliation
  @Post('reconciliation/funding')
  async reconcileFunding(@Req() req: any, @Body() dto: ReconciliationRequestDto) {
    const tenantId = this.getTenantId(req);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const reconciliation = await this.fundingReconciliationService.runReconciliation({
      tenantId,
      fundingRequestId: dto.fundingRequestId ?? null,
      withdrawalRequestId: dto.withdrawalRequestId ?? null,
      reconciliationType: dto.reconciliationType,
    });

    return redactPiiAndSecrets(reconciliation);
  }

  @Post('reconciliation/lifecycle')
  async reconcileLifecycle(@Req() req: any, @Body() body: { clientProfileId?: string; accountId?: string }) {
    const tenantId = this.getTenantId(req);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const result = await this.reconciliationService.runFullReconciliation({
      tenantId,
      clientProfileId: body.clientProfileId,
      accountId: body.accountId,
    });

    return redactPiiAndSecrets(result);
  }

  // Reviews
  @Post('reviews')
  async createReview(@Req() req: any, @Body() dto: CreateReviewDto) {
    const tenantId = this.getTenantId(req);
    if (dto.clientProfileId) await this.enforceTenantIsolationForProfile(tenantId, dto.clientProfileId);
    if (dto.accountId) await this.enforceTenantIsolationForAccount(tenantId, dto.accountId);

    const review = await this.reviewService.createReview({
      tenantId,
      clientProfileId: dto.clientProfileId ?? null,
      accountId: dto.accountId ?? null,
      reviewType: dto.reviewType as any,
      reviewerId: this.getUserId(req),
      reason: dto.reason ?? null,
      reviewPeriodStart: dto.reviewPeriodStart ? new Date(dto.reviewPeriodStart) : null,
      reviewPeriodEnd: dto.reviewPeriodEnd ? new Date(dto.reviewPeriodEnd) : null,
      evidenceReferences: dto.evidenceReferences ?? [],
      nextReviewDate: dto.nextReviewDate ? new Date(dto.nextReviewDate) : null,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    await this.notificationService.notifyReviewRequired({
      tenantId,
      clientProfileId: dto.clientProfileId ?? null,
      accountId: dto.accountId ?? null,
      reviewType: dto.reviewType,
      reviewId: review.id,
    });

    return redactPiiAndSecrets(review);
  }

  @Post('reviews/decide')
  async decideReview(@Req() req: any, @Body() dto: DecideReviewDto) {
    const tenantId = this.getTenantId(req);
    await this.enforcePlatformRBAC(req, 'PLATFORM_MANAGE');

    const decided = await this.reviewService.decideReview({
      tenantId,
      reviewId: dto.reviewId,
      decision: dto.decision as any,
      reviewerId: this.getUserId(req),
      reason: dto.reason,
      nextReviewDate: dto.nextReviewDate ? new Date(dto.nextReviewDate) : null,
      correlationId: req.headers['x-correlation-id'] ?? null,
    });

    return redactPiiAndSecrets(decided);
  }

  @Get('reviews')
  async listReviews(@Req() req: any, @Query() query: ReviewQueryDto) {
    const tenantId = this.getTenantId(req);
    if (query.clientProfileId) await this.enforceTenantIsolationForProfile(tenantId, query.clientProfileId);
    if (query.accountId) await this.enforceTenantIsolationForAccount(tenantId, query.accountId);

    return await this.reviewService.listReviews({
      tenantId,
      clientProfileId: query.clientProfileId,
      accountId: query.accountId,
      reviewType: query.reviewType,
      decision: query.decision,
      page: query.page,
      limit: query.limit,
    });
  }

  // Audits
  @Get('audits')
  async listAudits(@Req() req: any, @Query() query: LifecycleAuditQueryDto) {
    const tenantId = this.getTenantId(req);
    const userId = this.getUserId(req);
    const role = this.getUserRole(req);
    const isPlatform = this.isPlatformUser(req);

    // Only platform, tenant owner, compliance, security can view lifecycle audits
    if (!isPlatform && ![ClientVisibilityRole.TENANT_OWNER, ClientVisibilityRole.COMPLIANCE_REVIEWER, ClientVisibilityRole.SECURITY_ADMIN, ClientVisibilityRole.PLATFORM_ADMIN].includes(role)) {
      throw new ForbiddenException('Access denied to lifecycle audit');
    }

    return await this.auditService.listAudits({
      tenantId,
      clientProfileId: query.clientProfileId,
      accountId: query.accountId,
      action: query.action,
      entityType: query.entityType,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }
}
