import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** "ONBOARDING_STARTED" -> "Onboarding started". */
export function lifecycleNotificationTitle(type: string): string {
  const words = type.toLowerCase().split('_').filter(Boolean).join(' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Account update';
}

/** Short body text: the reason when present, otherwise a generic account-update line. */
export function lifecycleNotificationBody(type: string, payload: any): string {
  const reason = payload && typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : null;
  const base = `${lifecycleNotificationTitle(type)} on your account.`;
  const text = reason ? `${base} Reason: ${reason}` : base;
  return text.length > 1000 ? `${text.slice(0, 997)}...` : text;
}

/**
 * Emits onboarding, approval, restriction, suspension, funding, withdrawal, review, and closure events
 * through existing Billing/Notification infrastructure without implementing a second notification provider.
 */

@Injectable()
export class LifecycleNotificationService {
  private readonly logger = new Logger(LifecycleNotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async emitViaExistingNotification(params: {
    tenantId: string;
    type: string;
    recipientId?: string | null;
    clientProfileId?: string | null;
    accountId?: string | null;
    payload: any;
  }): Promise<void> {
    const { tenantId, type, recipientId = null, clientProfileId = null, accountId = null, payload } = params;

    // Reuse existing NotificationsModule — check if notification model exists
    try {
      // Notification rows need a recipient user (userId is a required FK) plus title/body.
      if (recipientId && (this.prisma as any).notification?.create) {
        await (this.prisma as any).notification.create({
          data: {
            tenantId,
            userId: recipientId,
            type: `CLIENT_LIFECYCLE_${type}`,
            title: lifecycleNotificationTitle(type),
            body: lifecycleNotificationBody(type, payload),
            data: {
              clientProfileId,
              accountId,
              ...payload,
              source: 'ClientLifecycleModule',
            } as any,
          },
        });
      } else {
        // Fallback: log via logger — no second notification provider
        this.logger.log({
          event: `client.notification.${type}`,
          tenantId,
          clientProfileId,
          accountId,
          recipientId,
          payload,
          note: 'Emitted via existing notification infrastructure',
        });
      }
    } catch (e) {
      this.logger.warn(`Failed to emit notification ${type}: ${(e as Error).message}`);
    }
  }

  async notifyOnboardingStarted(params: { tenantId: string; clientProfileId: string; onboardingId: string; recipientId?: string | null }): Promise<void> {
    await this.emitViaExistingNotification({
      tenantId: params.tenantId,
      type: 'ONBOARDING_STARTED',
      clientProfileId: params.clientProfileId,
      payload: { onboardingId: params.onboardingId },
      recipientId: params.recipientId ?? null,
    });
  }

  async notifyOnboardingApproved(params: { tenantId: string; clientProfileId: string; onboardingId: string; recipientId?: string | null }): Promise<void> {
    await this.emitViaExistingNotification({
      tenantId: params.tenantId,
      type: 'ONBOARDING_APPROVED',
      clientProfileId: params.clientProfileId,
      payload: { onboardingId: params.onboardingId },
      recipientId: params.recipientId ?? null,
    });
  }

  async notifyApprovalRequired(params: { tenantId: string; clientProfileId?: string | null; accountId?: string | null; requestType: string; requestId: string; recipientId?: string | null }): Promise<void> {
    await this.emitViaExistingNotification({
      tenantId: params.tenantId,
      type: `${params.requestType}_APPROVAL_REQUIRED`,
      clientProfileId: params.clientProfileId ?? null,
      accountId: params.accountId ?? null,
      payload: { requestType: params.requestType, requestId: params.requestId },
      recipientId: params.recipientId ?? null,
    });
  }

  async notifyRestrictionApplied(params: { tenantId: string; accountId?: string | null; clientProfileId?: string | null; restrictionType: string; reason: string; recipientId?: string | null }): Promise<void> {
    await this.emitViaExistingNotification({
      tenantId: params.tenantId,
      type: 'RESTRICTION_APPLIED',
      accountId: params.accountId ?? null,
      clientProfileId: params.clientProfileId ?? null,
      payload: { restrictionType: params.restrictionType, reason: params.reason },
      recipientId: params.recipientId ?? null,
    });
  }

  async notifySuspension(params: { tenantId: string; accountId: string; reason: string; recipientId?: string | null }): Promise<void> {
    await this.emitViaExistingNotification({
      tenantId: params.tenantId,
      type: 'ACCOUNT_SUSPENDED',
      accountId: params.accountId,
      payload: { reason: params.reason },
      recipientId: params.recipientId ?? null,
    });
  }

  async notifyFundingRequested(params: { tenantId: string; accountId: string; fundingRequestId: string; amount: string; currency: string; recipientId?: string | null }): Promise<void> {
    await this.emitViaExistingNotification({
      tenantId: params.tenantId,
      type: 'FUNDING_REQUESTED',
      accountId: params.accountId,
      payload: { fundingRequestId: params.fundingRequestId, amount: params.amount, currency: params.currency },
      recipientId: params.recipientId ?? null,
    });
  }

  async notifyWithdrawalRequested(params: { tenantId: string; accountId: string; withdrawalRequestId: string; amount: string; currency: string; recipientId?: string | null }): Promise<void> {
    await this.emitViaExistingNotification({
      tenantId: params.tenantId,
      type: 'WITHDRAWAL_REQUESTED',
      accountId: params.accountId,
      payload: { withdrawalRequestId: params.withdrawalRequestId, amount: params.amount, currency: params.currency },
      recipientId: params.recipientId ?? null,
    });
  }

  async notifyFundingConfirmed(params: { tenantId: string; accountId: string; fundingRequestId: string; confirmedAmount: string; currency: string; recipientId?: string | null }): Promise<void> {
    await this.emitViaExistingNotification({
      tenantId: params.tenantId,
      type: 'FUNDING_CONFIRMED',
      accountId: params.accountId,
      payload: { fundingRequestId: params.fundingRequestId, confirmedAmount: params.confirmedAmount, currency: params.currency },
      recipientId: params.recipientId ?? null,
    });
  }

  async notifyAccountClosed(params: { tenantId: string; accountId: string; reason: string; recipientId?: string | null }): Promise<void> {
    await this.emitViaExistingNotification({
      tenantId: params.tenantId,
      type: 'ACCOUNT_CLOSED',
      accountId: params.accountId,
      payload: { reason: params.reason },
      recipientId: params.recipientId ?? null,
    });
  }

  async notifyReviewRequired(params: { tenantId: string; clientProfileId?: string | null; accountId?: string | null; reviewType: string; reviewId: string; recipientId?: string | null }): Promise<void> {
    await this.emitViaExistingNotification({
      tenantId: params.tenantId,
      type: 'REVIEW_REQUIRED',
      clientProfileId: params.clientProfileId ?? null,
      accountId: params.accountId ?? null,
      payload: { reviewType: params.reviewType, reviewId: params.reviewId },
      recipientId: params.recipientId ?? null,
    });
  }
}
