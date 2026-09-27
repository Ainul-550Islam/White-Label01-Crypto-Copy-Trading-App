import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PlansService } from '../plans.service';
import { SubscriptionsService } from '../subscriptions.service';
import { TenantFeatureAccessService } from './tenant-feature-access.service';
import { SaasTenantBrandingService } from './tenant-branding.service';
import { CustomDomainService } from './custom-domain.service';
import { WhiteLabelProvisioningService } from './white-label-provisioning.service';
import { BillingCustomerService } from '../finance/billing-customer.service';
import type {
  SaasTenantSummary,
  SaasTenantDetail,
  SaasTenantListFilter,
  SaasTenantListResult,
  SaasSubscriptionSummary,
  SaasBrandingState,
  SaasCustomDomainState,
  SaasWhiteLabelState,
} from './saas-admin.types';
import { TenantLifecycleState, ProvisioningState, SaasAdminAction } from './saas-admin.types';
import { TenantStatus } from '@wlct/shared-types';

/**
 * Main SaaS admin orchestration layer combining tenant, subscription, plan,
 * entitlement, branding, domain, billing services without duplicate state.
 */
@Injectable()
export class SaasAdminService {
  private readonly logger = new Logger(SaasAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly featureAccessService: TenantFeatureAccessService,
    private readonly brandingService: SaasTenantBrandingService,
    private readonly domainService: CustomDomainService,
    private readonly whiteLabelService: WhiteLabelProvisioningService,
    private readonly billingCustomerService: BillingCustomerService,
  ) {}

  async listTenants(filter: SaasTenantListFilter): Promise<SaasTenantListResult> {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (!filter.includeDeleted) {
      where.deletedAt = null;
    }
    if (filter.status) {
      where.status = filter.status;
    }
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { slug: { contains: filter.search.toLowerCase() } },
        { contactEmail: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    const [tenants, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        include: { branding: true, subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { [filter.sortBy || 'createdAt']: filter.sortOrder || 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.tenant.count({ where }),
    ]);

    const items: SaasTenantSummary[] = await Promise.all(
      tenants.map(async (tenant: any) => this.mapTenantToSummary(tenant)),
    );

    // Filter by planCode if requested
    let filteredItems = items;
    if (filter.planCode) {
      filteredItems = items.filter((t) => t.subscriptionSummary?.planCode === filter.planCode);
    }

    return {
      items: filteredItems,
      total: filter.planCode ? filteredItems.length : total,
      page,
      limit,
      totalPages: Math.ceil((filter.planCode ? filteredItems.length : total) / limit),
    };
  }

  async getTenantDetail(tenantId: string): Promise<SaasTenantDetail> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        branding: true,
        domains: true,
        subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' } },
        featureFlags: true,
      },
    });

    if (!tenant) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    const summary = await this.mapTenantToSummary(tenant);
    const entitlements = await this.featureAccessService.getEffectiveFeatureAccess(tenantId);
    const limits = await this.featureAccessService.getEffectiveLimits(tenantId);
    const availableActions = this.determineAvailableActions(tenant, summary);

    // Billing customer
    let billingCustomer: SaasTenantDetail['billingCustomer'] = null;
    try {
      const customer = await this.billingCustomerService.getBillingCustomer(tenantId);
      if (customer) {
        billingCustomer = {
          billingName: customer.billingName,
          billingEmail: customer.billingEmail,
          billingCountry: customer.billingCountry,
          preferredCurrency: customer.preferredCurrency,
        };
      }
    } catch {}

    const domains = (tenant.domains || []).map((d: any) => ({
      id: d.id,
      domain: d.domain,
      isPrimary: d.isPrimary,
      status: d.status,
      verifiedAt: d.verifiedAt ? d.verifiedAt.toISOString() : null,
      createdAt: d.createdAt.toISOString(),
    }));

    const featureFlags = (tenant.featureFlags || []).map((f: any) => ({
      key: f.key,
      enabled: f.enabled,
      value: f.value,
    }));

    return {
      ...summary,
      entitlements,
      limits,
      availableActions,
      billingCustomer,
      domains,
      featureFlags,
    };
  }

  async getTenantSummary(tenantId: string): Promise<SaasTenantSummary> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        branding: true,
        subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!tenant) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    return this.mapTenantToSummary(tenant);
  }

  private async mapTenantToSummary(tenant: any): Promise<SaasTenantSummary> {
    const subscription = tenant.subscriptions?.[0] || null;

    let subscriptionSummary: SaasSubscriptionSummary | null = null;
    if (subscription) {
      subscriptionSummary = {
        id: subscription.id,
        tenantId: tenant.id,
        planId: subscription.planId,
        planCode: subscription.plan?.code || null,
        planName: subscription.plan?.name || null,
        status: subscription.status,
        interval: subscription.plan?.interval || null,
        currentPeriodStart: subscription.currentPeriodStart?.toISOString() || null,
        currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
        trialEndsAt: subscription.trialEndsAt?.toISOString() || null,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || false,
        isActive: ['ACTIVE', 'TRIALING'].includes(subscription.status),
        isPastDue: subscription.status === 'PAST_DUE',
        renewalDate: subscription.currentPeriodEnd?.toISOString() || null,
        seatsPurchased: subscription.seatsPurchased || null,
      };
    }

    // Branding state
    let brandingState: SaasBrandingState | null = null;
    try {
      brandingState = await this.brandingService.getBrandingState(tenant.id);
    } catch {
      brandingState = null;
    }

    // Domain state
    let customDomainState: SaasCustomDomainState | null = null;
    try {
      customDomainState = await this.domainService.getDomainState(tenant.id);
    } catch {
      customDomainState = null;
    }

    // White-label state
    let whiteLabelState: SaasWhiteLabelState | null = null;
    try {
      whiteLabelState = await this.whiteLabelService.getWhiteLabelState(tenant.id);
    } catch {
      whiteLabelState = null;
    }

    // Usage summary
    let usageSummary: any = null;
    try {
      const usersCount = await this.prisma.user.count({ where: { tenantId: tenant.id, deletedAt: null } });
      const tradersCount = (await (this.prisma as any).trader?.count({ where: { tenantId: tenant.id } })) ?? 0;
      usageSummary = {
        tenantId: tenant.id,
        maxUsers: tenant.maxUsers || (subscription?.plan?.limits as any)?.maxUsers || null,
        currentUsers: usersCount,
        maxTraders: tenant.maxTraders || (subscription?.plan?.limits as any)?.maxTraders || null,
        currentTraders: tradersCount,
        apiRequestsPerMinute: (subscription?.plan?.limits as any)?.maxApiRequestsPerMinute || null,
        websocketConnections: (subscription?.plan?.limits as any)?.websocketConnections || null,
      };
    } catch {
      usageSummary = null;
    }

    // Determine lifecycle and provisioning
    const lifecycleState = this.mapTenantStatusToLifecycle(tenant.status, subscription?.status);
    const provisioningState = this.determineProvisioningState(tenant, subscription);

    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      legalName: tenant.legalName || null,
      status: tenant.status as TenantStatus,
      lifecycleState,
      provisioningState,
      contactEmail: tenant.contactEmail || null,
      countryCode: tenant.countryCode || null,
      defaultCurrency: tenant.defaultCurrency || 'USD',
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
      subscriptionSummary,
      brandingState,
      customDomainState,
      whiteLabelState,
      usageSummary,
    };
  }

  private mapTenantStatusToLifecycle(tenantStatus: string, subscriptionStatus: string | null): TenantLifecycleState {
    switch (tenantStatus) {
      case 'PENDING':
        return TenantLifecycleState.PENDING;
      case 'ACTIVE':
        if (subscriptionStatus === 'PAST_DUE') return TenantLifecycleState.PAST_DUE;
        if (subscriptionStatus === 'CANCELED') return TenantLifecycleState.CANCELED;
        return TenantLifecycleState.ACTIVE;
      case 'SUSPENDED':
        return TenantLifecycleState.SUSPENDED;
      case 'CANCELED':
        return TenantLifecycleState.CANCELED;
      default:
        return TenantLifecycleState.ACTIVE;
    }
  }

  private determineProvisioningState(tenant: any, subscription: any): ProvisioningState {
    const metadata = tenant.metadata as any;
    const provState = metadata?.provisioning?.state;

    if (provState === 'COMPLETED') return ProvisioningState.COMPLETED;
    if (provState === 'FAILED') return ProvisioningState.FAILED;
    if (provState === 'IN_PROGRESS') return ProvisioningState.IN_PROGRESS;

    // If tenant exists and has branding, consider completed
    if (tenant.branding) return ProvisioningState.COMPLETED;

    return ProvisioningState.NOT_STARTED;
  }

  private determineAvailableActions(tenant: any, summary: SaasTenantSummary): SaasAdminAction[] {
    const actions: SaasAdminAction[] = [];

    actions.push(SaasAdminAction.VIEW_FEATURE_ACCESS);

    if (!summary.subscriptionSummary) {
      actions.push(SaasAdminAction.ASSIGN_PLAN);
    } else {
      actions.push(SaasAdminAction.CHANGE_PLAN);
      actions.push(SaasAdminAction.CHANGE_INTERVAL);
    }

    if (tenant.status === 'ACTIVE') {
      actions.push(SaasAdminAction.SUSPEND_TENANT);
    } else if (tenant.status === 'SUSPENDED') {
      actions.push(SaasAdminAction.ACTIVATE_TENANT);
    }

    actions.push(SaasAdminAction.UPDATE_BRANDING);

    if (summary.customDomainState?.entitlementAllowed) {
      if (!summary.customDomainState.domain) {
        actions.push(SaasAdminAction.REGISTER_DOMAIN);
      } else {
        if (summary.customDomainState.verificationRequired) {
          actions.push(SaasAdminAction.VERIFY_DOMAIN);
        }
        actions.push(SaasAdminAction.REMOVE_DOMAIN);
      }
    }

    if (summary.whiteLabelState?.entitlementAllowed) {
      if (summary.whiteLabelState.provisioningState === 'NOT_REQUESTED') {
        actions.push(SaasAdminAction.REQUEST_WHITE_LABEL);
      } else if (summary.whiteLabelState.provisioningState === 'REQUESTED') {
        actions.push(SaasAdminAction.ENABLE_WHITE_LABEL);
      } else if (summary.whiteLabelState.provisioningState === 'ACTIVE') {
        actions.push(SaasAdminAction.DISABLE_WHITE_LABEL);
      }
    }

    return actions;
  }
}
