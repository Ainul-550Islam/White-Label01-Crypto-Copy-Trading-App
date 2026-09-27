import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { RequestMeta, type RequestMetadata } from '../../../common/decorators/request-context.decorator';
import { ApiStandardResponses } from '../../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../../common/pipes/parse-uuid.pipe';
import { Permission, type AuthenticatedActor, BillingInterval } from '@wlct/shared-types';

import { SaasAdminService } from './saas-admin.service';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantPlanManagementService } from './tenant-plan-management.service';
import { TenantFeatureAccessService } from './tenant-feature-access.service';
import { SaasTenantBrandingService } from './tenant-branding.service';
import { CustomDomainService } from './custom-domain.service';
import { CustomDomainVerificationService } from './custom-domain-verification.service';
import { WhiteLabelProvisioningService } from './white-label-provisioning.service';

import { SaasTenantListQueryDto, ProvisionTenantRequestDto } from './dto/saas-tenant.dto';
import { AssignPlanRequestDto, ChangePlanRequestDto, ChangeBillingIntervalRequestDto } from './dto/saas-plan-action.dto';
import { UpdateBrandingRequestDto } from './dto/branding-action.dto';
import { RegisterDomainRequestDto, VerifyDomainRequestDto, RemoveDomainRequestDto } from './dto/custom-domain.dto';
import { WhiteLabelActionRequestDto } from './dto/feature-access.dto';

/**
 * RBAC-protected SaaS admin control-plane API.
 * All tenant operations tenant-isolated and RBAC-controlled.
 * No arbitrary tenant access to unprivileged users.
 */
@ApiTags('Billing - SaaS Admin')
@ApiBearerAuth()
@Controller({ path: 'billing/saas-admin', version: '1' })
@ApiStandardResponses()
export class SaasAdminController {
  constructor(
    private readonly saasAdminService: SaasAdminService,
    private readonly provisioningService: TenantProvisioningService,
    private readonly planManagementService: TenantPlanManagementService,
    private readonly featureAccessService: TenantFeatureAccessService,
    private readonly brandingService: SaasTenantBrandingService,
    private readonly domainService: CustomDomainService,
    private readonly verificationService: CustomDomainVerificationService,
    private readonly whiteLabelService: WhiteLabelProvisioningService,
  ) {}

  // Tenant listing/detail - SaaS operator only
  @Get('tenants')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'List tenants for SaaS admin - operator scoped' })
  @ApiOkResponse({ description: 'Tenant list' })
  async listTenants(@Query() query: SaasTenantListQueryDto) {
    return this.saasAdminService.listTenants({
      status: query.status as any,
      planCode: query.planCode,
      search: query.search,
      includeDeleted: query.includeDeleted,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
  }

  @Get('tenants/:id')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Get tenant detail for SaaS admin' })
  @ApiOkResponse({ description: 'Tenant detail' })
  async getTenant(@Param('id', ParseUuidPipe) id: string) {
    return this.saasAdminService.getTenantDetail(id);
  }

  @Post('tenants/provision')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Provision new SaaS tenant - idempotent' })
  @ApiOkResponse({ description: 'Provisioning result' })
  async provisionTenant(@Body() dto: ProvisionTenantRequestDto, @CurrentUser() actor: AuthenticatedActor, @RequestMeta() meta: RequestMetadata) {
    return this.provisioningService.provisionTenant(
      {
        slug: dto.slug,
        name: dto.name,
        legalName: dto.legalName,
        contactEmail: dto.contactEmail,
        countryCode: dto.countryCode,
        defaultCurrency: dto.defaultCurrency,
        planId: dto.planId,
        billingEmail: dto.billingEmail,
        billingName: dto.billingName,
        idempotencyKey: dto.idempotencyKey,
      },
      {
        actorId: actor.userId,
        isPlatformUser: actor.isPlatformUser,
        tenantId: actor.tenantId,
      },
    );
  }

  @Get('tenants/:id/subscription')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Get tenant subscription/plan for admin' })
  @ApiOkResponse({ description: 'Subscription' })
  async getTenantSubscription(@Param('id', ParseUuidPipe) id: string) {
    const detail = await this.saasAdminService.getTenantDetail(id);
    return {
      tenantId: id,
      subscription: detail.subscriptionSummary,
      plan: detail.subscriptionSummary ? { planId: detail.subscriptionSummary.planId, planCode: detail.subscriptionSummary.planCode, planName: detail.subscriptionSummary.planName } : null,
      fetchedAt: new Date().toISOString(),
    };
  }

  @Post('tenants/:id/plan/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Assign initial plan via existing subscription logic' })
  @ApiOkResponse({ description: 'Plan assignment result' })
  async assignPlan(@Param('id', ParseUuidPipe) id: string, @Body() dto: AssignPlanRequestDto, @CurrentUser() actor: AuthenticatedActor, @RequestMeta() meta: RequestMetadata) {
    const result = await this.planManagementService.assignInitialPlan(id, dto.planId, {
      actorId: actor.userId,
      isPlatformUser: actor.isPlatformUser,
      tenantId: actor.tenantId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });

    return {
      tenantId: id,
      action: 'ASSIGN_PLAN',
      planId: dto.planId,
      subscriptionId: result.id,
      previousPlanId: null,
      changeType: 'ASSIGN_INITIAL',
      message: `Plan ${result.plan?.code || dto.planId} assigned to tenant ${id}`,
      updatedAt: new Date().toISOString(),
    };
  }

  @Post('tenants/:id/plan/change')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Request plan change via canonical billing flow' })
  @ApiOkResponse({ description: 'Plan change result' })
  async changePlan(@Param('id', ParseUuidPipe) id: string, @Body() dto: ChangePlanRequestDto, @CurrentUser() actor: AuthenticatedActor, @RequestMeta() meta: RequestMetadata) {
    const result = await this.planManagementService.changePlan(id, dto.planId, {
      atPeriodEnd: dto.atPeriodEnd,
      actorId: actor.userId,
      isPlatformUser: actor.isPlatformUser,
      tenantId: actor.tenantId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });

    return {
      tenantId: id,
      action: 'CHANGE_PLAN',
      planId: dto.planId,
      subscriptionId: result.subscription?.id || result.checkout?.checkoutId || null,
      previousPlanId: result.currentPlan?.id || null,
      changeType: result.changeType,
      priceDelta: result.priceDelta || null,
      effectiveAt: result.effectiveAt || null,
      message: result.message,
      requiresCheckout: result.requiresCheckout || false,
      checkout: result.checkout || null,
      updatedAt: new Date().toISOString(),
    };
  }

  @Post('tenants/:id/plan/change-interval')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Change billing interval' })
  @ApiOkResponse({ description: 'Interval change result' })
  async changeInterval(@Param('id', ParseUuidPipe) id: string, @Body() dto: ChangeBillingIntervalRequestDto, @CurrentUser() actor: AuthenticatedActor, @RequestMeta() meta: RequestMetadata) {
    const result = await this.planManagementService.changeBillingInterval(id, dto.newInterval as BillingInterval, {
      actorId: actor.userId,
      isPlatformUser: actor.isPlatformUser,
      tenantId: actor.tenantId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });

    return {
      tenantId: id,
      action: 'CHANGE_INTERVAL',
      planId: result.requestedPlan?.id || result.subscription?.planId || '',
      subscriptionId: result.subscription?.id || null,
      changeType: 'INTERVAL_CHANGE',
      effectiveAt: result.effectiveAt || null,
      message: result.message,
      requiresCheckout: result.requiresCheckout || false,
      checkout: result.checkout || null,
      updatedAt: new Date().toISOString(),
    };
  }

  @Get('tenants/:id/feature-access')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Get effective feature access - canonical entitlement system' })
  @ApiOkResponse({ description: 'Feature access' })
  async getFeatureAccess(@Param('id', ParseUuidPipe) id: string, @CurrentUser() actor: AuthenticatedActor) {
    const [features, limits] = await Promise.all([
      this.featureAccessService.getEffectiveFeatureAccess(id, actor.userId),
      this.featureAccessService.getEffectiveLimits(id),
    ]);

    return {
      tenantId: id,
      features,
      limits,
      fetchedAt: new Date().toISOString(),
    };
  }

  @Get('tenants/:id/feature-access/:featureKey')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Check single feature access' })
  @ApiOkResponse({ description: 'Feature check' })
  async checkFeature(@Param('id', ParseUuidPipe) id: string, @Param('featureKey') featureKey: string) {
    const access = await this.featureAccessService.checkFeatureAccess(id, featureKey);
    return {
      tenantId: id,
      featureKey,
      allowed: access.enabled,
      reason: access.reason,
      planCode: access.planCode,
      subscriptionStatus: access.subscriptionStatus,
      source: access.source,
    };
  }

  // Branding
  @Get('tenants/:id/branding')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Get tenant branding state' })
  @ApiOkResponse({ description: 'Branding state' })
  async getBranding(@Param('id', ParseUuidPipe) id: string) {
    return this.brandingService.getBrandingState(id);
  }

  @Post('tenants/:id/branding')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Update tenant branding - sanitized, tenant-isolated' })
  @ApiOkResponse({ description: 'Updated branding' })
  async updateBranding(@Param('id', ParseUuidPipe) id: string, @Body() dto: UpdateBrandingRequestDto, @CurrentUser() actor: AuthenticatedActor, @RequestMeta() meta: RequestMetadata) {
    const updated = await this.brandingService.updateBranding(id, dto as any, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });

    return {
      ...updated,
      message: 'Branding updated successfully',
    };
  }

  // Custom domains
  @Get('tenants/:id/domains')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'List custom domains for tenant' })
  @ApiOkResponse({ description: 'Domain list' })
  async listDomains(@Param('id', ParseUuidPipe) id: string) {
    const domains = await this.domainService.listDomains(id);
    const state = await this.domainService.getDomainState(id);
    return {
      tenantId: id,
      domains,
      total: domains.length,
      currentState: state,
      fetchedAt: new Date().toISOString(),
    };
  }

  @Get('tenants/:id/domains/status')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Get custom domain state with entitlement' })
  @ApiOkResponse({ description: 'Domain state' })
  async getDomainStatus(@Param('id', ParseUuidPipe) id: string) {
    return this.domainService.getDomainState(id);
  }

  @Post('tenants/:id/domains/register')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Register custom domain - requires customDomain entitlement' })
  @ApiOkResponse({ description: 'Registration result' })
  async registerDomain(@Param('id', ParseUuidPipe) id: string, @Body() dto: RegisterDomainRequestDto, @CurrentUser() actor: AuthenticatedActor) {
    const result = await this.domainService.registerDomain(id, dto.domain, dto.isPrimary, actor.userId);
    return {
      ...result,
      tenantId: id,
    };
  }

  @Post('tenants/:id/domains/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Verify custom domain - challenge validation' })
  @ApiOkResponse({ description: 'Verification result' })
  async verifyDomain(@Param('id', ParseUuidPipe) id: string, @Body() dto: VerifyDomainRequestDto, @CurrentUser() actor: AuthenticatedActor) {
    return this.verificationService.verifyDomain(id, dto.domain, actor.userId);
  }

  @Post('tenants/:id/domains/verification-challenge')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Generate domain verification challenge' })
  @ApiOkResponse({ description: 'Challenge' })
  async generateChallenge(@Param('id', ParseUuidPipe) id: string, @Body() dto: VerifyDomainRequestDto, @CurrentUser() actor: AuthenticatedActor) {
    const challenge = await this.verificationService.generateChallenge(id, dto.domain, actor.userId);
    return {
      domain: challenge.domain,
      token: `${challenge.token.substring(0, 8)}...`,
      verificationRecord: `wlct-verification=${challenge.token.substring(0, 8)}...`,
      verificationType: challenge.verificationType,
      expiresAt: challenge.expiresAt.toISOString(),
      attempts: challenge.attempts,
      maxAttempts: challenge.maxAttempts,
      message: `Add TXT record: _wlct-challenge.${challenge.domain} with value wlct-verification=${challenge.token}`,
    };
  }

  @Get('tenants/:id/domains/:domain/verification-status')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Get verification status' })
  @ApiOkResponse({ description: 'Verification status' })
  async getVerificationStatus(@Param('id', ParseUuidPipe) id: string, @Param('domain') domain: string) {
    return this.verificationService.getVerificationStatus(id, domain);
  }

  @Delete('tenants/:id/domains')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Remove custom domain - tenant-safe' })
  @ApiOkResponse({ description: 'Removal result' })
  async removeDomain(@Param('id', ParseUuidPipe) id: string, @Body() dto: RemoveDomainRequestDto, @CurrentUser() actor: AuthenticatedActor) {
    const result = await this.domainService.removeDomain(id, dto.domain, actor.userId);
    return {
      ...result,
      message: `Domain ${dto.domain} removed`,
    };
  }

  // White-label
  @Get('tenants/:id/white-label')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Get white-label state - entitlement gated' })
  @ApiOkResponse({ description: 'White-label state' })
  async getWhiteLabelState(@Param('id', ParseUuidPipe) id: string) {
    return this.whiteLabelService.getWhiteLabelState(id);
  }

  @Post('tenants/:id/white-label/request')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Request white-label provisioning - requires entitlement' })
  @ApiOkResponse({ description: 'Request result' })
  async requestWhiteLabel(@Param('id', ParseUuidPipe) id: string, @Body() dto: WhiteLabelActionRequestDto, @CurrentUser() actor: AuthenticatedActor) {
    return this.whiteLabelService.requestWhiteLabel(id, actor.userId, dto.configuration);
  }

  @Post('tenants/:id/white-label/enable')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Enable white-label - entitlement must permit' })
  @ApiOkResponse({ description: 'Enable result' })
  async enableWhiteLabel(@Param('id', ParseUuidPipe) id: string, @CurrentUser() actor: AuthenticatedActor) {
    return this.whiteLabelService.enableWhiteLabel(id, actor.userId);
  }

  @Post('tenants/:id/white-label/disable')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  @ApiOperation({ summary: 'Disable white-label' })
  @ApiOkResponse({ description: 'Disable result' })
  async disableWhiteLabel(@Param('id', ParseUuidPipe) id: string, @Body() dto: WhiteLabelActionRequestDto, @CurrentUser() actor: AuthenticatedActor) {
    return this.whiteLabelService.disableWhiteLabel(id, actor.userId, dto.reason);
  }
}
