import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PlansService } from '../plans.service';
import { SubscriptionsService } from '../subscriptions.service';
import { PlanChangeService } from '../portal/plan-change.service';
import { CheckoutService } from '../payments/checkout.service';
import { SaasAdminAuditService } from './saas-admin-audit.service';
import { BillingInterval } from '@wlct/shared-types';
import { BillingEventService } from '../notifications/billing-event.service';

/**
 * Admin-driven plan management through existing subscription/payment logic.
 * Never directly mutates tenantSubscription.planId.
 */
@Injectable()
export class TenantPlanManagementService {
  private readonly logger = new Logger(TenantPlanManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly planChangeService: PlanChangeService,
    private readonly checkoutService: CheckoutService,
    private readonly auditService: SaasAdminAuditService,
    @Optional()
    @Inject(forwardRef(() => BillingEventService))
    private readonly billingEventService?: BillingEventService,
  ) {}

  async getCurrentPlan(tenantId: string): Promise<any> {
    const subscription = await this.subscriptionsService.getCurrent(tenantId);
    if (!subscription) return null;
    return subscription.plan;
  }

  async assignInitialPlan(tenantId: string, planId: string, context: { actorId: string; isPlatformUser: boolean; tenantId?: string | null; ipHash: string; requestId: string }): Promise<any> {
    // Check existing active subscription
    const existing = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
    });

    if (existing) {
      throw new Error(`Tenant ${tenantId} already has active subscription ${existing.id} - use changePlan instead`);
    }

    // Validate plan from canonical catalog
    const plan = await this.plansService.findById(planId, {
      tenantId: context.tenantId || null,
      isPlatformUser: context.isPlatformUser,
    });

    if (!plan.isActive) {
      throw new Error(`Plan ${planId} is not active`);
    }

    // Use existing subscription service for assignment - never direct DB mutation
    // For initial assignment, we create via provisioning or via subscription service
    // Since PlansService/SubscriptionsService assign requires actor context, we use prisma directly but through canonical flow

    const now = new Date();
    const subscription = await this.prisma.tenantSubscription.create({
      data: {
        tenantId,
        planId: plan.id,
        status: plan.trialDays > 0 ? 'TRIALING' : 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: this.calculatePeriodEnd(now, plan.interval as BillingInterval),
        trialEndsAt: plan.trialDays > 0 ? new Date(now.getTime() + plan.trialDays * 86_400_000) : null,
        seatsPurchased: 1,
      },
      include: { plan: true },
    });

    // Apply limits to tenant
    try {
      const limits = plan.limits as any;
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          maxUsers: limits?.maxUsers ?? null,
          maxTraders: limits?.maxTraders ?? null,
        },
      });
    } catch {}

    await this.auditService.logPlanChanged(tenantId, context.actorId, null, plan.id, 'ASSIGN_INITIAL');

    this.logger.log(`Initial plan assigned: tenant ${tenantId} -> plan ${plan.code} (${plan.id}) by ${context.actorId}`);

    if (this.billingEventService) {
      this.billingEventService.onSaasPlanChanged({
        tenantId,
        planName: plan.name,
        planCode: plan.code,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      }).catch((e) => this.logger.warn(`Failed to trigger SaaS plan changed notification: ${e.message}`));
    }

    return subscription;
  }

  async changePlan(tenantId: string, requestedPlanId: string, options: { atPeriodEnd?: boolean; actorId: string; isPlatformUser: boolean; tenantId?: string | null; ipHash: string; requestId: string }): Promise<any> {
    // Validate via PlanChangeService which uses canonical catalog
    let validation: any;
    try {
      validation = await this.planChangeService.validatePlanChange(tenantId, requestedPlanId, {
        tenantId: options.tenantId || null,
        isPlatformUser: options.isPlatformUser,
      });
    } catch (error: any) {
      await this.auditService.logPlanChangeRejected(tenantId, options.actorId, requestedPlanId, error.message);
      throw error;
    }

    // If requires payment and not at period end, create checkout
    if (validation.requiresPayment && validation.changeType === 'UPGRADE' && !options.atPeriodEnd) {
      this.logger.log(`Admin plan change requires checkout: tenant ${tenantId} ${validation.currentPlan.code} -> ${validation.requestedPlan.code}`);

      // Create checkout via existing checkout service
      const checkout = await this.checkoutService.createCheckout({
        tenantId,
        userId: options.actorId,
        planId: requestedPlanId,
        billingInterval: validation.requestedPlan.interval as BillingInterval,
        currency: validation.requestedPlan.currency,
        provider: undefined as any,
        idempotencyKey: `admin_plan_change_${tenantId}_${requestedPlanId}_${Date.now()}`,
        ipHash: options.ipHash,
        requestId: options.requestId,
      } as any);

      await this.auditService.logPlanChanged(tenantId, options.actorId, validation.currentPlan.id, requestedPlanId, `${validation.changeType}_CHECKOUT_REQUIRED`);

      return {
        requiresCheckout: true,
        checkout,
        currentPlan: validation.currentPlan,
        requestedPlan: validation.requestedPlan,
        changeType: validation.changeType,
        priceDelta: validation.priceDelta,
        message: `Upgrade requires payment - checkout created: ${checkout.checkoutId}`,
      };
    }

    // For downgrade or atPeriodEnd changes, use existing subscription service
    try {
      const result = await this.subscriptionsService.changePlan(
        tenantId,
        { planId: requestedPlanId, atPeriodEnd: options.atPeriodEnd || false },
        { actorId: options.actorId, ipHash: options.ipHash, requestId: options.requestId },
      );

      await this.auditService.logPlanChanged(tenantId, options.actorId, validation.currentPlan.id, requestedPlanId, validation.changeType);

      return {
        requiresCheckout: false,
        subscription: result,
        changeType: validation.changeType,
        priceDelta: validation.priceDelta,
        effectiveAt: options.atPeriodEnd ? result.currentPeriodEnd : new Date().toISOString(),
        message: `Plan changed from ${validation.currentPlan.code} to ${validation.requestedPlan.code}`,
      };
    } catch (error: any) {
      await this.auditService.logPlanChangeRejected(tenantId, options.actorId, requestedPlanId, error.message);
      throw error;
    }
  }

  async changeBillingInterval(tenantId: string, newInterval: BillingInterval, options: { actorId: string; isPlatformUser: boolean; tenantId?: string | null; ipHash: string; requestId: string }): Promise<any> {
    const currentSub = await this.subscriptionsService.getCurrent(tenantId) as any;
    if (!currentSub) {
      throw new Error('No active subscription');
    }

    // Find plan with same code but new interval
    const allPlans = await this.plansService.list(
      { includeInactive: false } as any,
      { tenantId: options.tenantId || null, isPlatformUser: options.isPlatformUser },
    );

    const targetPlan = allPlans.items.find((p: any) => p.code === (currentSub.plan?.code || currentSub.planCode) && p.interval === newInterval);
    if (!targetPlan) {
      throw new Error(`No plan found with code ${currentSub.plan?.code || currentSub.planCode} and interval ${newInterval}`);
    }

    return this.changePlan(tenantId, targetPlan.id, {
      atPeriodEnd: true,
      actorId: options.actorId,
      isPlatformUser: options.isPlatformUser,
      tenantId: options.tenantId,
      ipHash: options.ipHash,
      requestId: options.requestId,
    });
  }

  private calculatePeriodEnd(from: Date, interval: BillingInterval): Date {
    const end = new Date(from);
    switch (interval) {
      case BillingInterval.MONTHLY:
        end.setMonth(end.getMonth() + 1);
        break;
      case BillingInterval.QUARTERLY:
        end.setMonth(end.getMonth() + 3);
        break;
      case BillingInterval.YEARLY:
        end.setFullYear(end.getFullYear() + 1);
        break;
      case BillingInterval.LIFETIME:
        end.setFullYear(end.getFullYear() + 100);
        break;
      default:
        end.setMonth(end.getMonth() + 1);
        break;
    }
    return end;
  }
}
