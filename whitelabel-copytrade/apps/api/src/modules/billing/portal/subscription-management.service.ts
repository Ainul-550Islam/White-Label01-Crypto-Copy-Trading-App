import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionsService } from '../subscriptions.service';
import { PlanChangeService } from './plan-change.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BillingInterval } from '@wlct/shared-types';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';

/**
 * Customer subscription lifecycle management.
 * Uses existing subscription/payment architecture as single source of truth.
 * No second subscription state machine.
 */
@Injectable()
export class SubscriptionManagementService {
  private readonly logger = new Logger(SubscriptionManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly planChangeService: PlanChangeService,
  ) {}

  async getCurrentSubscription(tenantId: string): Promise<any> {
    const subscription = await this.subscriptionsService.getCurrent(tenantId);
    if (!subscription) {
      return null;
    }
    return subscription;
  }

  async cancelAtPeriodEnd(tenantId: string, reason: string | undefined, context: { actorId: string; ipHash: string; requestId: string }): Promise<any> {
    const current = await this.subscriptionsService.getCurrent(tenantId);
    if (!current) {
      throw new AppException({ code: ErrorCode.NOT_FOUND, message: 'No active subscription' });
    }

    if (current.cancelAtPeriodEnd) {
      throw new AppException({ code: ErrorCode.VALIDATION_ERROR, message: 'Subscription already set to cancel at period end' });
    }

    const result = await this.subscriptionsService.cancel(
      tenantId,
      { atPeriodEnd: true, reason },
      { actorId: context.actorId, ipHash: context.ipHash, requestId: context.requestId },
    );

    this.logger.log(`Subscription cancel at period end: tenant ${tenantId}, subscription ${result.id}, reason ${reason || 'N/A'}`);

    return {
      subscription: result,
      effectiveAt: result.currentPeriodEnd,
      message: `Subscription will be canceled at period end: ${result.currentPeriodEnd}`,
    };
  }

  async resumeCancelled(tenantId: string, context: { actorId: string; ipHash: string; requestId: string }): Promise<any> {
    const current = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId, cancelAtPeriodEnd: true, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!current) {
      throw new AppException({ code: ErrorCode.NOT_FOUND, message: 'No subscription pending cancellation found' });
    }

    const updated = await this.prisma.tenantSubscription.update({
      where: { id: current.id },
      data: { cancelAtPeriodEnd: false, cancelReason: null },
      include: { plan: true },
    });

    this.logger.log(`Subscription resumed: tenant ${tenantId}, subscription ${current.id}`);

    return {
      subscription: updated,
      message: 'Subscription cancellation has been reversed - subscription will continue',
    };
  }

  async changePlan(
    tenantId: string,
    requestedPlanId: string,
    options: { atPeriodEnd?: boolean; actorId: string; ipHash: string; requestId: string; actor: { tenantId: string | null; isPlatformUser: boolean } },
  ): Promise<any> {
    return this.planChangeService.changePlan(tenantId, requestedPlanId, options);
  }

  async changeBillingInterval(
    tenantId: string,
    newInterval: BillingInterval,
    options: { actorId: string; ipHash: string; requestId: string; actor: { tenantId: string | null; isPlatformUser: boolean } },
  ): Promise<any> {
    const current = await this.subscriptionsService.getCurrent(tenantId);
    if (!current) {
      throw new AppException({ code: ErrorCode.NOT_FOUND, message: 'No active subscription' });
    }

    return this.planChangeService.changeBillingInterval(tenantId, current.planId, newInterval, options);
  }

  async getSubscriptionState(tenantId: string): Promise<{
    subscription: any | null;
    canCancel: boolean;
    canResume: boolean;
    canChangePlan: boolean;
    canChangeInterval: boolean;
    effectiveActions: string[];
  }> {
    const subscription = await this.subscriptionsService.getCurrent(tenantId);

    if (!subscription) {
      return {
        subscription: null,
        canCancel: false,
        canResume: false,
        canChangePlan: false,
        canChangeInterval: false,
        effectiveActions: ['CHECKOUT'],
      };
    }

    const canCancel = !subscription.cancelAtPeriodEnd && ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(subscription.status);
    const canResume = subscription.cancelAtPeriodEnd && ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(subscription.status);
    const canChangePlan = ['ACTIVE', 'TRIALING'].includes(subscription.status);
    const canChangeInterval = ['ACTIVE', 'TRIALING'].includes(subscription.status);

    const effectiveActions: string[] = [];
    if (canChangePlan) {
      effectiveActions.push('UPGRADE', 'DOWNGRADE');
    }
    if (canChangeInterval) {
      effectiveActions.push('CHANGE_INTERVAL');
    }
    if (canCancel) {
      effectiveActions.push('CANCEL_AT_PERIOD_END');
    }
    if (canResume) {
      effectiveActions.push('RESUME');
    }

    return {
      subscription,
      canCancel,
      canResume,
      canChangePlan,
      canChangeInterval,
      effectiveActions,
    };
  }
}
