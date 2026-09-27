import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  AuditAction,
  AuditActorType,
  AuditOutcome,
  BillingInterval,
  SubscriptionStatus,
  type PlanLimits,
  type SubscriptionPlanDto,
  type TenantSubscriptionDto,
} from '@wlct/shared-types';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlansService } from './plans.service';
import { BillingEventService } from './notifications/billing-event.service';
import { ConflictException, NotFoundException } from '../../common/errors/app.exception';
import type {
  AssignSubscriptionDto,
  CancelSubscriptionDto,
  ChangePlanDto,
} from './dto/subscription.dto';

/**
 * Tenant subscription lifecycle and entitlements.
 *
 * Entitlement checks live here rather than being scattered across modules, so
 * there is exactly one answer to "is this tenant allowed to add another user".
 * Payment capture is not performed in-process: the provider holds card data and
 * this service records the resulting state against the provider's identifiers.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @InjectPinoLogger(SubscriptionsService.name) private readonly logger: PinoLogger,
    @Optional()
    @Inject(forwardRef(() => BillingEventService))
    private readonly billingEventService?: BillingEventService,
  ) {}

  async getCurrent(tenantId: string): Promise<TenantSubscriptionDto | null> {
    const subscription = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });

    return subscription ? this.toDto(subscription, this.plans.toDto(subscription.plan)) : null;
  }

  async assign(
    tenantId: string,
    dto: AssignSubscriptionDto,
    context: { actorId: string; ipHash: string; requestId: string },
  ): Promise<TenantSubscriptionDto> {
    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: { id: dto.planId, deletedAt: null, isActive: true },
    });

    if (!plan) {
      throw new NotFoundException('Subscription plan', dto.planId);
    }

    const existing = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        'This organisation already has an active subscription. Change the plan instead.',
        { subscriptionId: existing.id },
      );
    }

    const now = new Date();
    const subscription = await this.prisma.tenantSubscription.create({
      data: {
        tenantId,
        planId: plan.id,
        status: plan.trialDays > 0 ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: this.periodEnd(now, plan.interval as BillingInterval),
        trialEndsAt:
          plan.trialDays > 0 ? new Date(now.getTime() + plan.trialDays * 86_400_000) : null,
        seatsPurchased: dto.seatsPurchased,
        externalCustomerId: dto.externalCustomerId ?? null,
        externalSubscriptionId: dto.externalSubscriptionId ?? null,
      },
      include: { plan: true },
    });

    await this.applyPlanLimitsToTenant(tenantId, plan.limits as unknown as PlanLimits);

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.SUBSCRIPTION_CREATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'TenantSubscription',
      resourceId: subscription.id,
      description: `Subscribed to plan ${plan.code}`,
      metadata: { planCode: plan.code, seats: dto.seatsPurchased },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    await this.notifyOwner(tenantId, 'billing.subscription_activated', { planName: plan.name });

    if (this.billingEventService) {
      this.billingEventService.onSubscriptionActivated({
        tenantId,
        subscriptionId: subscription.id,
        planName: plan.name,
        planCode: plan.code,
        renewalDate: subscription.currentPeriodEnd.toISOString(),
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      }).catch((e) => this.logger.warn({ err: e }, 'Failed to trigger subscription activated billing notification'));
    }

    return this.toDto(subscription, this.plans.toDto(subscription.plan));
  }

  async changePlan(
    tenantId: string,
    dto: ChangePlanDto,
    context: { actorId: string; ipHash: string; requestId: string },
  ): Promise<TenantSubscriptionDto> {
    const [subscription, plan] = await Promise.all([
      this.prisma.tenantSubscription.findFirst({
        where: { tenantId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.subscriptionPlan.findFirst({
        where: { id: dto.planId, deletedAt: null, isActive: true },
      }),
    ]);

    if (!subscription) {
      throw new NotFoundException('Active subscription', tenantId);
    }
    if (!plan) {
      throw new NotFoundException('Subscription plan', dto.planId);
    }

    const now = new Date();
    const updated = await this.prisma.tenantSubscription.update({
      where: { id: subscription.id },
      data: dto.atPeriodEnd
        ? // Scheduled change: keep the current entitlements until the period
          // rolls over, and record the intent in metadata for the billing job.
          {
            metadata: {
              ...((subscription.metadata as Record<string, unknown>) ?? {}),
              pendingPlanId: plan.id,
              pendingPlanCode: plan.code,
              pendingEffectiveAt: subscription.currentPeriodEnd.toISOString(),
            },
          }
        : {
            planId: plan.id,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: now,
            currentPeriodEnd: this.periodEnd(now, plan.interval as BillingInterval),
          },
      include: { plan: true },
    });

    if (!dto.atPeriodEnd) {
      await this.applyPlanLimitsToTenant(tenantId, plan.limits as unknown as PlanLimits);
    }

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.SUBSCRIPTION_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'TenantSubscription',
      resourceId: subscription.id,
      description: dto.atPeriodEnd
        ? `Plan change to ${plan.code} scheduled for the end of the period`
        : `Plan changed to ${plan.code}`,
      changes: { planId: { before: subscription.planId, after: plan.id } },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    if (this.billingEventService) {
      if (dto.atPeriodEnd) {
        this.billingEventService.onSubscriptionCancellationScheduled({
          tenantId,
          subscriptionId: updated.id,
          planName: plan.name,
          renewalDate: updated.currentPeriodEnd.toISOString(),
          supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
          appName: process.env.APP_NAME || 'WLCT',
        }).catch((e) => this.logger.warn({ err: e }, 'Failed to trigger subscription cancellation scheduled notification'));
      } else {
        this.billingEventService.onSubscriptionChanged({
          tenantId,
          subscriptionId: updated.id,
          planName: plan.name,
          planCode: plan.code,
          renewalDate: updated.currentPeriodEnd.toISOString(),
          supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
          appName: process.env.APP_NAME || 'WLCT',
        }).catch((e) => this.logger.warn({ err: e }, 'Failed to trigger subscription changed notification'));
      }
    }

    return this.toDto(updated, this.plans.toDto(updated.plan));
  }

  async cancel(
    tenantId: string,
    dto: CancelSubscriptionDto,
    context: { actorId: string; ipHash: string; requestId: string },
  ): Promise<TenantSubscriptionDto> {
    const subscription = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      throw new NotFoundException('Active subscription', tenantId);
    }

    const updated = await this.prisma.tenantSubscription.update({
      where: { id: subscription.id },
      data: dto.atPeriodEnd
        ? {
            cancelAtPeriodEnd: true,
            cancelReason: dto.reason ?? null,
          }
        : {
            status: SubscriptionStatus.CANCELED,
            canceledAt: new Date(),
            cancelAtPeriodEnd: false,
            cancelReason: dto.reason ?? null,
          },
      include: { plan: true },
    });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.SUBSCRIPTION_CANCELED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'TenantSubscription',
      resourceId: subscription.id,
      description: dto.atPeriodEnd
        ? 'Subscription set to cancel at period end'
        : 'Subscription cancelled immediately',
      metadata: { reason: dto.reason ?? null },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    await this.notifyOwner(tenantId, 'billing.subscription_cancelled', {
      planName: subscription.plan.name,
    });

    if (this.billingEventService) {
      if (dto.atPeriodEnd) {
        this.billingEventService.onSubscriptionCancellationScheduled({
          tenantId,
          subscriptionId: updated.id,
          planName: subscription.plan.name,
          renewalDate: updated.currentPeriodEnd.toISOString(),
          supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
          appName: process.env.APP_NAME || 'WLCT',
        }).catch((e) => this.logger.warn({ err: e }, 'Failed to trigger subscription cancellation scheduled notification'));
      } else {
        this.billingEventService.onSubscriptionChanged({
          tenantId,
          subscriptionId: updated.id,
          planName: subscription.plan.name,
          planCode: subscription.plan.code,
          renewalDate: updated.currentPeriodEnd.toISOString(),
          supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
          appName: process.env.APP_NAME || 'WLCT',
        }).catch((e) => this.logger.warn({ err: e }, 'Failed to trigger subscription changed notification'));
      }
    }

    return this.toDto(updated, this.plans.toDto(updated.plan));
  }

  async resume(
    tenantId: string,
    context: { actorId: string; ipHash: string; requestId: string },
  ): Promise<TenantSubscriptionDto> {
    const subscription = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId, cancelAtPeriodEnd: true, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      throw new NotFoundException('Cancellable subscription', tenantId);
    }

    const updated = await this.prisma.tenantSubscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: false, cancelReason: null },
      include: { plan: true },
    });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.SUBSCRIPTION_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'TenantSubscription',
      resourceId: subscription.id,
      description: 'Subscription resumed',
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    if (this.billingEventService) {
      this.billingEventService.onSubscriptionResumed({
        tenantId,
        subscriptionId: updated.id,
        planName: updated.plan.name,
        renewalDate: updated.currentPeriodEnd.toISOString(),
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      }).catch((e) => this.logger.warn({ err: e }, 'Failed to trigger subscription resumed notification'));
    }

    return this.toDto(updated, this.plans.toDto(updated.plan));
  }

  async checkTrialEnding(daysBefore: number = 3): Promise<{ notified: number }> {
    const now = new Date();
    const threshold = new Date(now.getTime() + daysBefore * 24 * 60 * 60 * 1000);

    const trialsEnding = await this.prisma.tenantSubscription.findMany({
      where: {
        status: 'TRIALING',
        trialEndsAt: { gte: now, lte: threshold },
      },
      include: { plan: true },
    });

    let notified = 0;
    for (const sub of trialsEnding) {
      try {
        if (this.billingEventService) {
          await this.billingEventService.onTrialEnding({
            tenantId: sub.tenantId,
            subscriptionId: sub.id,
            planName: sub.plan.name,
            trialEndsAt: sub.trialEndsAt!.toISOString(),
            supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
            appName: process.env.APP_NAME || 'WLCT',
          });
          notified++;
        }
      } catch {}
    }

    return { notified };
  }

  /**
   * Single source of truth for entitlement questions.
   *
   * Returns the limit value from the active plan, or the fallback when the
   * tenant has no subscription (self-hosted and platform-internal tenants).
   */
  async getLimits(tenantId: string): Promise<PlanLimits | null> {
    const subscription = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId, status: { in: ['TRIALING', 'ACTIVE'] } },
      include: { plan: { select: { limits: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return subscription ? ((subscription.plan.limits as unknown as PlanLimits) ?? null) : null;
  }

  /** True when the tenant may still create another user account. */
  async canAddUser(tenantId: string): Promise<{ allowed: boolean; limit: number | null }> {
    const [limits, tenant] = await Promise.all([
      this.getLimits(tenantId),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { maxUsers: true } }),
    ]);

    const limit = tenant?.maxUsers ?? limits?.maxUsers ?? null;
    if (limit === null) {
      return { allowed: true, limit: null };
    }

    const used = await this.prisma.user.count({ where: { tenantId, deletedAt: null } });
    return { allowed: used < limit, limit };
  }

  /**
   * Rolls expired periods forward and flags overdue subscriptions. Invoked by
   * the billing queue; kept here so the state machine has one implementation.
   */
  async reconcileExpiredPeriods(): Promise<{ pastDue: number; expired: number }> {
    const now = new Date();

    const [pastDue, expired] = await this.prisma.$transaction([
      this.prisma.tenantSubscription.updateMany({
        where: {
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
          currentPeriodEnd: { lt: now },
          cancelAtPeriodEnd: false,
        },
        data: { status: SubscriptionStatus.PAST_DUE },
      }),
      this.prisma.tenantSubscription.updateMany({
        where: {
          currentPeriodEnd: { lt: now },
          cancelAtPeriodEnd: true,
          status: { not: SubscriptionStatus.CANCELED },
        },
        data: { status: SubscriptionStatus.CANCELED, canceledAt: now },
      }),
    ]);

    this.logger.info(
      { event: 'billing.reconciled', pastDue: pastDue.count, expired: expired.count },
      'Subscription periods reconciled',
    );

    return { pastDue: pastDue.count, expired: expired.count };
  }

  /** Mirrors plan seat limits onto the tenant so guards can read them cheaply. */
  private async applyPlanLimitsToTenant(tenantId: string, limits: PlanLimits): Promise<void> {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        maxUsers: limits?.maxUsers ?? null,
        maxTraders: limits?.maxTraders ?? null,
      },
    });
  }

  private async notifyOwner(
    tenantId: string,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { ownerUserId: true, defaultLocale: true },
    });

    if (!tenant?.ownerUserId) {
      return;
    }

    await this.notifications.enqueueTransactional({
      tenantId,
      userId: tenant.ownerUserId,
      type,
      locale: tenant.defaultLocale,
      data,
    });
  }

  private periodEnd(from: Date, interval: BillingInterval): Date {
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

  private toDto(
    subscription: {
      id: string;
      tenantId: string;
      planId: string;
      status: string;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      trialEndsAt: Date | null;
      cancelAtPeriodEnd: boolean;
      canceledAt: Date | null;
      externalCustomerId: string | null;
      externalSubscriptionId: string | null;
      seatsPurchased: number;
      createdAt: Date;
      updatedAt: Date;
    },
    plan: SubscriptionPlanDto,
  ): TenantSubscriptionDto {
    return {
      id: subscription.id,
      tenantId: subscription.tenantId,
      planId: subscription.planId,
      plan,
      status: subscription.status as SubscriptionStatus,
      currentPeriodStart: subscription.currentPeriodStart.toISOString(),
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      trialEndsAt: subscription.trialEndsAt ? subscription.trialEndsAt.toISOString() : null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      canceledAt: subscription.canceledAt ? subscription.canceledAt.toISOString() : null,
      externalCustomerId: subscription.externalCustomerId,
      externalSubscriptionId: subscription.externalSubscriptionId,
      seatsPurchased: subscription.seatsPurchased,
      createdAt: subscription.createdAt.toISOString(),
      updatedAt: subscription.updatedAt.toISOString(),
    };
  }
}
