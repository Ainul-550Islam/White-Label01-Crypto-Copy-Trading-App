import { Injectable, Logger } from '@nestjs/common';
import { PlansService } from '../plans.service';
import { SubscriptionsService } from '../subscriptions.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BillingInterval } from '@wlct/shared-types';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';

/**
 * Handles upgrade, downgrade, and same-plan billing-interval changes
 * using existing subscription/payment rules and entitlement system.
 * Never uses hardcoded plan names like if plan === "premium".
 * Uses canonical plan ID/code from existing catalog.
 */
@Injectable()
export class PlanChangeService {
  private readonly logger = new Logger(PlanChangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async validatePlanChange(tenantId: string, requestedPlanId: string, actor: { tenantId: string | null; isPlatformUser: boolean }): Promise<{
    currentSubscription: any;
    currentPlan: any;
    requestedPlan: any;
    changeType: 'UPGRADE' | 'DOWNGRADE' | 'INTERVAL_CHANGE' | 'SAME_PLAN';
    requiresPayment: boolean;
    priceDelta: string | null;
  }> {
    // Get current subscription from canonical source
    const currentSubscription = await this.subscriptionsService.getCurrent(tenantId);
    if (!currentSubscription) {
      throw new AppException({
        code: ErrorCode.NOT_FOUND,
        message: 'No active subscription found',
      });
    }

    // Get requested plan from canonical catalog - never hardcoded
    let requestedPlan: any;
    try {
      requestedPlan = await this.plansService.findById(requestedPlanId, {
        tenantId: actor.tenantId || tenantId,
        isPlatformUser: actor.isPlatformUser,
      });
    } catch {
      throw new AppException({
        code: ErrorCode.NOT_FOUND,
        message: `Plan not found: ${requestedPlanId}`,
      });
    }

    if (!requestedPlan.isActive) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Requested plan is not active',
      });
    }

    const currentPlan = currentSubscription.plan;

    const changeType = this.determineChangeType(currentPlan, requestedPlan);
    const { requiresPayment, priceDelta } = this.calculateFinancialDelta(currentPlan, requestedPlan, changeType);

    return {
      currentSubscription,
      currentPlan,
      requestedPlan,
      changeType,
      requiresPayment,
      priceDelta,
    };
  }

  async changePlan(
    tenantId: string,
    requestedPlanId: string,
    options: { atPeriodEnd?: boolean; actorId: string; ipHash: string; requestId: string; actor: { tenantId: string | null; isPlatformUser: boolean } },
  ): Promise<any> {
    const validation = await this.validatePlanChange(tenantId, requestedPlanId, options.actor);

    // For upgrades requiring payment, payment must be handled via checkout flow
    // We do not bypass payment when new plan requires it
    if (validation.requiresPayment && validation.changeType === 'UPGRADE' && !options.atPeriodEnd) {
      this.logger.log(`Plan change requires payment: tenant ${tenantId} from ${validation.currentPlan.code} to ${validation.requestedPlan.code}, delta ${validation.priceDelta}`);
      // Return info that checkout is required - actual payment via checkout service
      return {
        requiresCheckout: true,
        currentPlan: validation.currentPlan,
        requestedPlan: validation.requestedPlan,
        changeType: validation.changeType,
        priceDelta: validation.priceDelta,
        message: 'Payment required for upgrade - proceed to checkout',
      };
    }

    // For downgrade or same-price changes, use existing subscription service
    // All state transitions go through existing architecture
    const result = await this.subscriptionsService.changePlan(
      tenantId,
      { planId: requestedPlanId, atPeriodEnd: options.atPeriodEnd || false },
      { actorId: options.actorId, ipHash: options.ipHash, requestId: options.requestId },
    );

    this.logger.log(`Plan changed: tenant ${tenantId} from ${validation.currentPlan.code} to ${validation.requestedPlan.code}, type ${validation.changeType}, atPeriodEnd ${options.atPeriodEnd}`);

    return {
      requiresCheckout: false,
      subscription: result,
      changeType: validation.changeType,
      effectiveAt: options.atPeriodEnd ? result.currentPeriodEnd : new Date().toISOString(),
    };
  }

  async changeBillingInterval(
    tenantId: string,
    requestedPlanId: string,
    newInterval: BillingInterval,
    options: { actorId: string; ipHash: string; requestId: string; actor: { tenantId: string | null; isPlatformUser: boolean } },
  ): Promise<any> {
    // Validate plan exists and interval is supported
    const requestedPlan = await this.plansService.findById(requestedPlanId, {
      tenantId: options.actor.tenantId || tenantId,
      isPlatformUser: options.actor.isPlatformUser,
    });

    // Find plan with same code but different interval
    const allPlans = await this.plansService.list(
      { includeInactive: false } as any,
      { tenantId: options.actor.tenantId || tenantId, isPlatformUser: options.actor.isPlatformUser },
    );

    const targetPlan = allPlans.items.find((p) => p.code === requestedPlan.code && p.interval === newInterval);

    if (!targetPlan) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: `No plan found with code ${requestedPlan.code} and interval ${newInterval}`,
      });
    }

    return this.changePlan(tenantId, targetPlan.id, {
      atPeriodEnd: true,
      actorId: options.actorId,
      ipHash: options.ipHash,
      requestId: options.requestId,
      actor: options.actor,
    });
  }

  private determineChangeType(currentPlan: any, requestedPlan: any): 'UPGRADE' | 'DOWNGRADE' | 'INTERVAL_CHANGE' | 'SAME_PLAN' {
    if (currentPlan.id === requestedPlan.id) {
      return 'SAME_PLAN';
    }

    if (currentPlan.code === requestedPlan.code && currentPlan.interval !== requestedPlan.interval) {
      return 'INTERVAL_CHANGE';
    }

    const currentPrice = parseFloat(currentPlan.price || '0');
    const requestedPrice = parseFloat(requestedPlan.price || '0');

    if (requestedPrice > currentPrice) {
      return 'UPGRADE';
    }

    if (requestedPrice < currentPrice) {
      return 'DOWNGRADE';
    }

    // Same price, different plan code - treat as upgrade for safety
    return 'UPGRADE';
  }

  private calculateFinancialDelta(currentPlan: any, requestedPlan: any, changeType: string): { requiresPayment: boolean; priceDelta: string | null } {
    const currentPrice = parseFloat(currentPlan.price || '0');
    const requestedPrice = parseFloat(requestedPlan.price || '0');
    const delta = requestedPrice - currentPrice;

    if (changeType === 'UPGRADE') {
      return { requiresPayment: delta > 0, priceDelta: delta.toFixed(2) };
    }

    if (changeType === 'INTERVAL_CHANGE') {
      // Interval change may require payment if new interval is more expensive per period
      return { requiresPayment: delta > 0, priceDelta: delta.toFixed(2) };
    }

    // Downgrade or same plan - no immediate payment
    return { requiresPayment: false, priceDelta: delta.toFixed(2) };
  }
}
