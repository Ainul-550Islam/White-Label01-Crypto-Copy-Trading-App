import { Injectable, Logger } from '@nestjs/common';
import { PlansService } from '../plans.service';
import { SubscriptionsService } from '../subscriptions.service';
import { PaymentService } from '../payments/payment.service';
import { InvoiceRepository } from '../finance/invoice.repository';
import { BillingCustomerService } from '../finance/billing-customer.service';
import { BillingUsageSummaryService } from './billing-usage-summary.service';
import type {
  PortalBillingOverview,
  PortalSubscriptionState,
  PortalCurrentPlan,
  PortalAvailablePlan,
  PortalInvoiceSummary,
  PortalPaymentSummary,
  PortalBillingCustomer,
  PortalPlanComparison,
  PortalFeatureMatrixRow,
  PortalLimitMatrixRow,
} from './billing-portal.types';
import { PortalAvailableAction } from './billing-portal.types';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BillingInterval, SubscriptionStatus } from '@wlct/shared-types';

/**
 * Main portal aggregation service.
 * Composes canonical billing data into tenant-safe view without duplicating
 * plan/payment/subscription state.
 * Uses existing services as source of truth.
 */
@Injectable()
export class BillingPortalService {
  private readonly logger = new Logger(BillingPortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly paymentService: PaymentService,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly billingCustomerService: BillingCustomerService,
    private readonly usageSummaryService: BillingUsageSummaryService,
  ) {}

  async getBillingOverview(tenantId: string, actor: { tenantId: string | null; isPlatformUser: boolean; userId: string }): Promise<PortalBillingOverview> {
    // Tenant isolation: resolve tenant from authenticated context, not client input
    const effectiveTenantId = actor.isPlatformUser && actor.tenantId ? actor.tenantId : tenantId;
    if (!actor.isPlatformUser && actor.tenantId !== tenantId) {
      throw new Error('Tenant mismatch');
    }

    const [subscriptionState, availablePlansRaw, usage, latestInvoice, latestPayment, billingCustomer] = await Promise.all([
      this.getCurrentSubscriptionState(effectiveTenantId),
      this.getAvailablePlans(effectiveTenantId, actor),
      this.usageSummaryService.getUsageSummary(effectiveTenantId),
      this.getLatestInvoice(effectiveTenantId),
      this.getLatestPayment(effectiveTenantId),
      this.getBillingCustomerSafe(effectiveTenantId),
    ]);

    const currentPlan = subscriptionState.planId
      ? availablePlansRaw.find((p) => p.id === subscriptionState.planId) || null
      : null;

    const currentPlanMapped: PortalCurrentPlan | null = currentPlan
      ? {
          id: currentPlan.id,
          code: currentPlan.code,
          name: currentPlan.name,
          description: currentPlan.description,
          price: currentPlan.price,
          currency: currentPlan.currency,
          interval: currentPlan.interval as BillingInterval,
          trialDays: currentPlan.trialDays,
          limits: currentPlan.limits as any,
          features: currentPlan.features,
          isActive: currentPlan.isActive,
          sortOrder: currentPlan.sortOrder,
        }
      : null;

    const availablePlans: PortalAvailablePlan[] = availablePlansRaw.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      currency: plan.currency,
      interval: plan.interval as BillingInterval,
      trialDays: plan.trialDays,
      limits: plan.limits as any,
      features: plan.features,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
      isCurrent: plan.id === subscriptionState.planId,
      upgradeEligible: this.isUpgradeEligible(currentPlan, plan),
      downgradeEligible: this.isDowngradeEligible(currentPlan, plan),
      intervalChangeEligible: this.isIntervalChangeEligible(currentPlan, plan),
    }));

    const availableActions = this.determineAvailableActions(subscriptionState, currentPlanMapped);

    return {
      tenantId: effectiveTenantId,
      subscription: subscriptionState,
      currentPlan: currentPlanMapped,
      availablePlans,
      usage,
      latestInvoice,
      latestPayment,
      billingCustomer,
      availableActions,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getCurrentSubscriptionState(tenantId: string): Promise<PortalSubscriptionState> {
    const subscription = await this.subscriptionsService.getCurrent(tenantId);

    if (!subscription) {
      return {
        id: null,
        tenantId,
        planId: null,
        planCode: null,
        planName: null,
        status: null,
        interval: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        seatsPurchased: null,
        renewalDate: null,
        trialActive: false,
        isActive: false,
        isPastDue: false,
        isCanceled: false,
        isTrialing: false,
        willCancelAtPeriodEnd: false,
      };
    }

    const now = new Date();
    const trialEndsAt = subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null;
    const trialActive = trialEndsAt ? trialEndsAt > now : false;

    return {
      id: subscription.id,
      tenantId: subscription.tenantId,
      planId: subscription.planId,
      planCode: subscription.plan?.code || null,
      planName: subscription.plan?.name || null,
      status: subscription.status as SubscriptionStatus,
      interval: (subscription.plan?.interval as BillingInterval) || null,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      trialEndsAt: subscription.trialEndsAt,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      canceledAt: subscription.canceledAt,
      seatsPurchased: subscription.seatsPurchased,
      renewalDate: subscription.currentPeriodEnd,
      trialActive,
      isActive: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING].includes(subscription.status as any),
      isPastDue: subscription.status === SubscriptionStatus.PAST_DUE,
      isCanceled: subscription.status === SubscriptionStatus.CANCELED,
      isTrialing: subscription.status === SubscriptionStatus.TRIALING,
      willCancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    };
  }

  async getAvailablePlans(tenantId: string, actor: { tenantId: string | null; isPlatformUser: boolean }): Promise<any[]> {
    // Source from canonical plan catalog, never hardcoded
    try {
      const result = await this.plansService.list(
        { includeInactive: false } as any,
        { tenantId: actor.tenantId || tenantId, isPlatformUser: actor.isPlatformUser },
      );
      return result.items.sort((a, b) => a.sortOrder - b.sortOrder);
    } catch {
      // Fallback to platform catalogue cached
      try {
        const catalog = await this.plansService.getPlatformCatalogue();
        return catalog.sort((a, b) => a.sortOrder - b.sortOrder);
      } catch {
        return [];
      }
    }
  }

  async getPlanComparison(tenantId: string, actor: { tenantId: string | null; isPlatformUser: boolean }): Promise<PortalPlanComparison> {
    const plansRaw = await this.getAvailablePlans(tenantId, actor);
    const subscriptionState = await this.getCurrentSubscriptionState(tenantId);

    const plans: PortalAvailablePlan[] = plansRaw.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      currency: plan.currency,
      interval: plan.interval as BillingInterval,
      trialDays: plan.trialDays,
      limits: plan.limits as any,
      features: plan.features,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
      isCurrent: plan.id === subscriptionState.planId,
      upgradeEligible: this.isUpgradeEligible(
        plansRaw.find((p) => p.id === subscriptionState.planId) || null,
        plan,
      ),
      downgradeEligible: this.isDowngradeEligible(
        plansRaw.find((p) => p.id === subscriptionState.planId) || null,
        plan,
      ),
      intervalChangeEligible: this.isIntervalChangeEligible(
        plansRaw.find((p) => p.id === subscriptionState.planId) || null,
        plan,
      ),
    }));

    // Build features matrix from canonical features
    const allFeatures = new Set<string>();
    for (const plan of plansRaw) {
      for (const f of plan.features || []) allFeatures.add(f);
      // Boolean limits as features
      if ((plan.limits as any)?.customDomain) allFeatures.add('customDomain');
      if ((plan.limits as any)?.whiteLabelMobileApp) allFeatures.add('whiteLabelMobileApp');
      if ((plan.limits as any)?.prioritySupport) allFeatures.add('prioritySupport');
    }

    const featuresMatrix: PortalFeatureMatrixRow[] = Array.from(allFeatures).map((featureKey) => {
      const plansMap: Record<string, boolean> = {};
      for (const plan of plansRaw) {
        const included =
          (plan.features || []).includes(featureKey) ||
          (featureKey === 'customDomain' && !!(plan.limits as any)?.customDomain) ||
          (featureKey === 'whiteLabelMobileApp' && !!(plan.limits as any)?.whiteLabelMobileApp) ||
          (featureKey === 'prioritySupport' && !!(plan.limits as any)?.prioritySupport);
        plansMap[plan.id] = included;
      }
      return { featureKey, label: this.featureLabel(featureKey), plans: plansMap };
    });

    // Build limits matrix
    const limitKeys = ['maxUsers', 'maxTraders', 'maxFollowersPerTrader', 'maxExchangeAccountsPerUser', 'maxCopySubscriptionsPerFollower', 'maxApiRequestsPerMinute', 'websocketConnections'];
    const limitsMatrix: PortalLimitMatrixRow[] = limitKeys.map((limitKey) => {
      const plansMap: Record<string, number | null> = {};
      for (const plan of plansRaw) {
        plansMap[plan.id] = (plan.limits as any)?.[limitKey] ?? null;
      }
      return { limitKey, label: this.limitLabel(limitKey), plans: plansMap };
    });

    return {
      tenantId,
      currentPlanId: subscriptionState.planId,
      plans,
      featuresMatrix,
      limitsMatrix,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getLatestInvoice(tenantId: string): Promise<PortalInvoiceSummary | null> {
    try {
      const invoices = await this.invoiceRepository.list({ tenantId } as any);
      if (!invoices || invoices.length === 0) return null;
      const latest = invoices.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      return this.mapInvoiceToSummary(latest);
    } catch {
      return null;
    }
  }

  async getLatestPayment(tenantId: string): Promise<PortalPaymentSummary | null> {
    try {
      const payments = await this.paymentService.listPaymentsByTenant(tenantId);
      if (!payments || payments.length === 0) return null;
      const latest = payments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      return {
        id: latest.id,
        provider: latest.provider,
        status: latest.status,
        amount: latest.amount,
        currency: latest.currency,
        planId: latest.planId,
        planCode: (latest as any).planCode || null,
        paidAt: latest.paidAt ? latest.paidAt.toISOString() : null,
        failedAt: latest.failedAt ? latest.failedAt.toISOString() : null,
        createdAt: latest.createdAt.toISOString(),
        checkoutUrl: (latest as any).checkoutUrl || null,
        invoiceUrl: (latest as any).invoiceUrl || null,
        hasInvoice: !!(latest as any).invoiceId,
      };
    } catch {
      return null;
    }
  }

  private async getBillingCustomerSafe(tenantId: string): Promise<PortalBillingCustomer | null> {
    try {
      const customer = await this.billingCustomerService.getBillingCustomer(tenantId);
      if (!customer) return null;
      return {
        tenantId: customer.tenantId,
        billingName: customer.billingName,
        billingEmail: customer.billingEmail,
        billingCountry: customer.billingCountry,
        billingCity: customer.billingCity,
        billingRegion: customer.billingRegion,
        preferredCurrency: customer.preferredCurrency,
        taxId: customer.taxId,
        vatNumber: customer.vatNumber,
        isBusinessCustomer: customer.isBusinessCustomer,
        isTaxExempt: customer.isTaxExempt,
      };
    } catch {
      return null;
    }
  }

  private mapInvoiceToSummary(invoice: any): PortalInvoiceSummary {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      issueDate: invoice.issueDate ? new Date(invoice.issueDate).toISOString() : new Date().toISOString(),
      dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString() : null,
      currency: invoice.currency,
      subtotal: invoice.subtotal,
      discountTotal: invoice.discountTotal,
      taxTotal: invoice.taxTotal,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      amountDue: invoice.amountDue,
      amountRefunded: invoice.amountRefunded,
      billingPeriodStart: invoice.billingPeriodStart ? new Date(invoice.billingPeriodStart).toISOString() : null,
      billingPeriodEnd: invoice.billingPeriodEnd ? new Date(invoice.billingPeriodEnd).toISOString() : null,
      planCode: invoice.planCode || null,
      planName: invoice.planName || null,
      pdfAvailable: true,
    };
  }

  private isUpgradeEligible(currentPlan: any | null, targetPlan: any): boolean {
    if (!currentPlan) return true;
    if (currentPlan.id === targetPlan.id) return false;
    const currentPrice = parseFloat(currentPlan.price || '0');
    const targetPrice = parseFloat(targetPlan.price || '0');
    return targetPrice > currentPrice;
  }

  private isDowngradeEligible(currentPlan: any | null, targetPlan: any): boolean {
    if (!currentPlan) return false;
    if (currentPlan.id === targetPlan.id) return false;
    const currentPrice = parseFloat(currentPlan.price || '0');
    const targetPrice = parseFloat(targetPlan.price || '0');
    return targetPrice < currentPrice;
  }

  private isIntervalChangeEligible(currentPlan: any | null, targetPlan: any): boolean {
    if (!currentPlan) return false;
    return currentPlan.code === targetPlan.code && currentPlan.interval !== targetPlan.interval;
  }

  private determineAvailableActions(subscription: PortalSubscriptionState, currentPlan: PortalCurrentPlan | null): PortalAvailableAction[] {
    const actions: PortalAvailableAction[] = [];

    if (!subscription.isActive) {
      actions.push(PortalAvailableAction.CHECKOUT);
      return actions;
    }

    actions.push(PortalAvailableAction.UPGRADE);
    actions.push(PortalAvailableAction.DOWNGRADE);
    actions.push(PortalAvailableAction.CHANGE_INTERVAL);
    actions.push(PortalAvailableAction.VIEW_INVOICES);
    actions.push(PortalAvailableAction.VIEW_PAYMENTS);

    if (subscription.willCancelAtPeriodEnd) {
      actions.push(PortalAvailableAction.RESUME);
    } else {
      actions.push(PortalAvailableAction.CANCEL_AT_PERIOD_END);
    }

    if (subscription.isPastDue) {
      actions.push(PortalAvailableAction.RENEW);
    }

    return actions;
  }

  private featureLabel(key: string): string {
    const labels: Record<string, string> = {
      customDomain: 'Custom Domain',
      whiteLabelMobileApp: 'White-Label Mobile App',
      prioritySupport: 'Priority Support',
      copyTrading: 'Copy Trading',
      apiAccess: 'API Access',
      webhooks: 'Webhooks',
      advancedAnalytics: 'Advanced Analytics',
    };
    return labels[key] || key;
  }

  private limitLabel(key: string): string {
    const labels: Record<string, string> = {
      maxUsers: 'Max Users',
      maxTraders: 'Max Traders',
      maxFollowersPerTrader: 'Max Followers per Trader',
      maxExchangeAccountsPerUser: 'Max Exchange Accounts per User',
      maxCopySubscriptionsPerFollower: 'Max Copy Subscriptions per Follower',
      maxApiRequestsPerMinute: 'API Requests per Minute',
      websocketConnections: 'WebSocket Connections',
    };
    return labels[key] || key;
  }
}
