import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BillingEventService } from './billing-event.service';

/**
 * Subscription event service: trial starting/ending, cancellation scheduled, resumed, changed.
 * Authoritative for subscription lifecycle events -> notifications.
 * Never mutates subscription state, only notifies.
 */

@Injectable()
export class SubscriptionEventService {
  private readonly logger = new Logger(SubscriptionEventService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billingEventService: BillingEventService,
  ) {}

  async checkTrialEnding(daysBefore: number = 3): Promise<{ checked: number; notified: number }> {
    const now = new Date();
    const threshold = new Date(now.getTime() + daysBefore * 24 * 60 * 60 * 1000);

    let trials: any[] = [];
    try {
      trials = await this.prisma.tenantSubscription.findMany({
        where: {
          status: 'TRIALING',
          trialEndsAt: { gte: now, lte: threshold },
        },
        include: { plan: true },
      });
    } catch (e: any) {
      this.logger.warn(`Failed to fetch trials ending: ${e.message}`);
      return { checked: 0, notified: 0 };
    }

    let notified = 0;
    for (const sub of trials) {
      try {
        await this.billingEventService.onTrialEnding({
          tenantId: sub.tenantId,
          subscriptionId: sub.id,
          planName: sub.plan?.name || sub.plan?.code || 'Plan',
          trialEndsAt: sub.trialEndsAt!.toISOString(),
          supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
          appName: process.env.APP_NAME || 'WLCT',
        });
        notified++;
      } catch (e: any) {
        this.logger.warn(`Failed to notify trial ending for ${sub.id}: ${e.message}`);
      }
    }

    return { checked: trials.length, notified };
  }

  async checkTrialStarting(daysAfter: number = 0): Promise<{ checked: number; notified: number }> {
    const now = new Date();
    const startWindow = new Date(now.getTime() - (daysAfter + 1) * 24 * 60 * 60 * 1000);
    const endWindow = new Date(now.getTime() - daysAfter * 24 * 60 * 60 * 1000);

    let trials: any[] = [];
    try {
      trials = await this.prisma.tenantSubscription.findMany({
        where: {
          status: 'TRIALING',
          createdAt: { gte: startWindow, lte: endWindow },
        },
        include: { plan: true },
      });
    } catch {
      return { checked: 0, notified: 0 };
    }

    let notified = 0;
    for (const sub of trials) {
      try {
        await this.billingEventService.onTrialStarting({
          tenantId: sub.tenantId,
          subscriptionId: sub.id,
          planName: sub.plan?.name || sub.plan?.code || 'Plan',
          trialEndsAt: sub.trialEndsAt?.toISOString() || new Date(now.getTime() + 14 * 86400000).toISOString(),
          supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
          appName: process.env.APP_NAME || 'WLCT',
        });
        notified++;
      } catch {}
    }

    return { checked: trials.length, notified };
  }

  async notifySubscriptionChanged(params: {
    tenantId: string;
    subscriptionId: string;
    planName: string;
    planCode?: string;
    renewalDate: string;
  }): Promise<void> {
    try {
      await this.billingEventService.onSubscriptionChanged({
        tenantId: params.tenantId,
        subscriptionId: params.subscriptionId,
        planName: params.planName,
        planCode: params.planCode || params.planName,
        renewalDate: params.renewalDate,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      });
    } catch (e: any) {
      this.logger.warn(`Failed to notify subscription changed: ${e.message}`);
    }
  }

  async notifyCancellationScheduled(params: {
    tenantId: string;
    subscriptionId: string;
    planName: string;
    renewalDate: string;
  }): Promise<void> {
    try {
      await this.billingEventService.onSubscriptionCancellationScheduled({
        tenantId: params.tenantId,
        subscriptionId: params.subscriptionId,
        planName: params.planName,
        renewalDate: params.renewalDate,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      });
    } catch (e: any) {
      this.logger.warn(`Failed to notify cancellation scheduled: ${e.message}`);
    }
  }

  async notifyResumed(params: {
    tenantId: string;
    subscriptionId: string;
    planName: string;
    renewalDate: string;
  }): Promise<void> {
    try {
      await this.billingEventService.onSubscriptionResumed({
        tenantId: params.tenantId,
        subscriptionId: params.subscriptionId,
        planName: params.planName,
        renewalDate: params.renewalDate,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      });
    } catch (e: any) {
      this.logger.warn(`Failed to notify resumed: ${e.message}`);
    }
  }
}
