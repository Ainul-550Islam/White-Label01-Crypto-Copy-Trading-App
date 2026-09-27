import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BillingEventService } from './billing-event.service';

/**
 * Dunning notification service: retry, recovered, final failure.
 * Authoritative dunning is DunningService; this service only notifies.
 * Never mutates subscription or payment state.
 */

@Injectable()
export class DunningNotificationService {
  private readonly logger = new Logger(DunningNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billingEventService: BillingEventService,
  ) {}

  async notifyDunningRetry(params: {
    tenantId: string;
    paymentId: string;
    dunningId?: string;
    attempt: number;
    maxAttempts: number;
    nextRetryAt?: string;
    amount: string;
    currency: string;
    userId?: string;
  }): Promise<void> {
    try {
      await this.billingEventService.onDunningRetry({
        tenantId: params.tenantId,
        dunningId: params.dunningId || `${params.tenantId}_${params.paymentId}_${params.attempt}`,
        paymentId: params.paymentId,
        userId: params.userId,
        amount: params.amount,
        currency: params.currency,
        dunningAttempt: params.attempt,
        dunningMaxAttempts: params.maxAttempts,
        nextRetryAt: params.nextRetryAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      });
      this.logger.log(`Dunning retry notification sent tenant=${params.tenantId} attempt=${params.attempt}`);
    } catch (e: any) {
      this.logger.warn(`Failed to notify dunning retry: ${e.message}`);
    }
  }

  async notifyDunningRecovered(params: {
    tenantId: string;
    paymentId: string;
    dunningId?: string;
    amount: string;
    currency: string;
    userId?: string;
  }): Promise<void> {
    try {
      await this.billingEventService.onDunningRecovered({
        tenantId: params.tenantId,
        dunningId: params.dunningId || `${params.tenantId}_${params.paymentId}_recovered`,
        paymentId: params.paymentId,
        userId: params.userId,
        amount: params.amount,
        currency: params.currency,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      });
    } catch (e: any) {
      this.logger.warn(`Failed to notify dunning recovered: ${e.message}`);
    }
  }

  async notifyDunningFinalFailure(params: {
    tenantId: string;
    paymentId: string;
    dunningId?: string;
    amount: string;
    currency: string;
    userId?: string;
  }): Promise<void> {
    try {
      await this.billingEventService.onDunningFinalFailure({
        tenantId: params.tenantId,
        dunningId: params.dunningId || `${params.tenantId}_${params.paymentId}_final`,
        paymentId: params.paymentId,
        userId: params.userId,
        amount: params.amount,
        currency: params.currency,
        dunningMaxAttempts: 4,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      });
    } catch (e: any) {
      this.logger.warn(`Failed to notify dunning final failure: ${e.message}`);
    }
  }

  async processDunningCasesNeedingNotification(): Promise<{ checked: number; notified: number }> {
    let cases: any[] = [];
    try {
      cases = await (this.prisma as any).dunningCase?.findMany?.({
        where: { status: 'ACTIVE', nextRetryAt: { lte: new Date() } },
        take: 50,
      }) || [];
    } catch {
      return { checked: 0, notified: 0 };
    }

    let notified = 0;
    for (const dunningCase of cases) {
      try {
        // Fetch payment for amount
        let payment: any;
        try {
          payment = await (this.prisma as any).payment?.findFirst?.({ where: { id: dunningCase.paymentId } });
        } catch {}

        await this.notifyDunningRetry({
          tenantId: dunningCase.tenantId,
          paymentId: dunningCase.paymentId,
          attempt: dunningCase.attempt || 1,
          maxAttempts: dunningCase.maxAttempts || 4,
          nextRetryAt: dunningCase.nextRetryAt?.toISOString(),
          amount: payment?.amount || '0',
          currency: payment?.currency || 'USD',
        });
        notified++;
      } catch {}
    }

    return { checked: cases.length, notified };
  }
}
