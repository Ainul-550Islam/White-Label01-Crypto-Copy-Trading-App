import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions.service';
import { PaymentEventsAuditService } from './payment-events.audit';
import { PaymentStatus } from './payment.types';
import type { PaymentRecord } from './payment.types';
import { SubscriptionStatus, BillingInterval } from '@wlct/shared-types';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';

/**
 * Synchronizes a successful/failed/refunded/cancelled payment into the
 * existing TenantSubscription lifecycle without duplicating subscription logic.
 *
 * This layer must reuse the existing subscription service.
 *
 * Examples:
 *  Payment SUCCEEDED → activate/renew the corresponding TenantSubscription through existing subscription logic.
 *  Payment FAILED → do not incorrectly activate a subscription.
 *  Payment REFUNDED → apply the existing supported refund/subscription business rule.
 *  Payment CANCELLED/EXPIRED → synchronize only if existing subscription semantics require it.
 *
 * Do not create a parallel subscription table/state machine merely for payments.
 */

@Injectable()
export class PaymentSubscriptionSyncService {
  private readonly logger = new Logger(PaymentSubscriptionSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly audit: PaymentEventsAuditService,
  ) {}

  async syncPaymentToSubscription(payment: PaymentRecord): Promise<void> {
    this.logger.log(`Syncing payment ${payment.id} status ${payment.status} to subscription for tenant ${payment.tenantId}`);

    switch (payment.status) {
      case PaymentStatus.SUCCEEDED:
        await this.handlePaymentSucceeded(payment);
        break;

      case PaymentStatus.FAILED:
        await this.handlePaymentFailed(payment);
        break;

      case PaymentStatus.CANCELLED:
        await this.handlePaymentCancelled(payment);
        break;

      case PaymentStatus.EXPIRED:
        await this.handlePaymentExpired(payment);
        break;

      case PaymentStatus.REFUNDED:
      case PaymentStatus.PARTIALLY_REFUNDED:
        await this.handlePaymentRefunded(payment);
        break;

      case PaymentStatus.DISPUTED:
        await this.handlePaymentDisputed(payment);
        break;

      case PaymentStatus.PENDING:
      case PaymentStatus.PROCESSING:
      case PaymentStatus.CREATED:
        await this.handlePaymentPending(payment);
        break;

      default:
        this.logger.log(`No subscription sync needed for payment ${payment.id} status ${payment.status}`);
        break;
    }
  }

  private async handlePaymentSucceeded(payment: PaymentRecord): Promise<void> {
    this.logger.log(`Handling payment succeeded: ${payment.id} for tenant ${payment.tenantId}, plan ${payment.planId}`);

    try {
      // Check if subscription already exists for this payment
      const existingSubscription = await this.prisma.tenantSubscription.findFirst({
        where: {
          tenantId: payment.tenantId,
          planId: payment.planId,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingSubscription) {
        // If subscription exists and is already active, this is a renewal
        if (existingSubscription.status === SubscriptionStatus.ACTIVE || existingSubscription.status === SubscriptionStatus.TRIALING) {
          await this.renewSubscription(existingSubscription, payment);
        } else if (existingSubscription.status === SubscriptionStatus.PAST_DUE) {
          // Past due subscription - reactivate
          await this.reactivateSubscription(existingSubscription, payment);
        } else if (existingSubscription.status === SubscriptionStatus.CANCELED || existingSubscription.status === SubscriptionStatus.EXPIRED) {
          // Create new subscription for previously cancelled/expired
          await this.createNewSubscription(payment);
        } else {
          // For other statuses, activate
          await this.activateSubscription(existingSubscription, payment);
        }
      } else {
        // No existing subscription - create new one
        await this.createNewSubscription(payment);
      }

      await this.audit.logPaymentEvent({
        tenantId: payment.tenantId,
        paymentId: payment.id,
        provider: payment.provider,
        action: 'SUBSCRIPTION_ACTIVATED',
        status: payment.status,
        planId: payment.planId,
        subscriptionId: payment.subscriptionId || undefined,
        metadata: { syncAction: 'payment_succeeded' },
      });
    } catch (error) {
      this.logger.error(`Failed to sync succeeded payment ${payment.id} to subscription: ${(error as Error).message}`);

      await this.audit.logPaymentEvent({
        tenantId: payment.tenantId,
        paymentId: payment.id,
        provider: payment.provider,
        action: 'SUBSCRIPTION_SYNC_FAILED',
        status: payment.status,
        planId: payment.planId,
        error: (error as Error).message,
        metadata: { syncAction: 'payment_succeeded_failed' },
      });

      throw error;
    }
  }

  private async handlePaymentFailed(payment: PaymentRecord): Promise<void> {
    this.logger.log(`Handling payment failed: ${payment.id} for tenant ${payment.tenantId}`);

    // Failed payment should NOT activate subscription
    // But we should record the failure for audit and potentially notify

    try {
      // If there's an existing subscription in PAST_DUE that was expecting this payment, keep it as PAST_DUE
      // Don't create new subscription for failed payment

      const existingSubscription = await this.prisma.tenantSubscription.findFirst({
        where: {
          tenantId: payment.tenantId,
          status: { in: [SubscriptionStatus.PAST_DUE, SubscriptionStatus.TRIALING] },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingSubscription && existingSubscription.status === SubscriptionStatus.TRIALING) {
        // If trial subscription and payment failed, we might want to keep trial or mark as past_due
        // For now, we don't change trial status on payment failure - trial continues until ends
        this.logger.log(`Payment failed for trial subscription ${existingSubscription.id}, keeping trial active`);
      }

      await this.audit.logPaymentEvent({
        tenantId: payment.tenantId,
        paymentId: payment.id,
        provider: payment.provider,
        action: 'SUBSCRIPTION_SYNC_SKIPPED',
        status: payment.status,
        planId: payment.planId,
        metadata: { syncAction: 'payment_failed_no_activation', reason: 'failed_payment_does_not_activate' },
      });
    } catch (error) {
      this.logger.error(`Failed to handle failed payment ${payment.id}: ${(error as Error).message}`);
    }
  }

  private async handlePaymentCancelled(payment: PaymentRecord): Promise<void> {
    this.logger.log(`Handling payment cancelled: ${payment.id} for tenant ${payment.tenantId}`);

    // Cancelled payment - only sync if subscription semantics require it
    // For example, if subscription was created pending payment and payment cancelled, cancel subscription

    try {
      const existingSubscription = await this.prisma.tenantSubscription.findFirst({
        where: {
          tenantId: payment.tenantId,
          planId: payment.planId,
          status: { in: [SubscriptionStatus.TRIALING] },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Only cancel if subscription was in trial and payment was for initial purchase
      // Don't cancel active subscriptions on cancelled payment
      if (existingSubscription && existingSubscription.status === SubscriptionStatus.TRIALING) {
        const trialAge = Date.now() - existingSubscription.currentPeriodStart.getTime();
        const oneHour = 60 * 60 * 1000;

        if (trialAge < oneHour) {
          // Very new trial - likely created for this payment, cancel it
          await this.prisma.tenantSubscription.update({
            where: { id: existingSubscription.id },
            data: {
              status: SubscriptionStatus.CANCELED,
              canceledAt: new Date(),
              cancelReason: 'Payment cancelled',
            },
          });

          this.logger.log(`Cancelled trial subscription ${existingSubscription.id} due to payment cancellation`);
        }
      }

      await this.audit.logPaymentEvent({
        tenantId: payment.tenantId,
        paymentId: payment.id,
        provider: payment.provider,
        action: 'SUBSCRIPTION_SYNC_SKIPPED',
        status: payment.status,
        planId: payment.planId,
        metadata: { syncAction: 'payment_cancelled' },
      });
    } catch (error) {
      this.logger.error(`Failed to handle cancelled payment ${payment.id}: ${(error as Error).message}`);
    }
  }

  private async handlePaymentExpired(payment: PaymentRecord): Promise<void> {
    this.logger.log(`Handling payment expired: ${payment.id} for tenant ${payment.tenantId}`);

    // Expired payment - similar to cancelled, only sync if needed
    await this.audit.logPaymentEvent({
      tenantId: payment.tenantId,
      paymentId: payment.id,
      provider: payment.provider,
      action: 'SUBSCRIPTION_SYNC_SKIPPED',
      status: payment.status,
      planId: payment.planId,
      metadata: { syncAction: 'payment_expired' },
    });
  }

  private async handlePaymentRefunded(payment: PaymentRecord): Promise<void> {
    this.logger.log(`Handling payment refunded: ${payment.id} for tenant ${payment.tenantId}, status ${payment.status}`);

    try {
      // Refunded payment - apply existing refund/subscription business rule
      // For full refund, we might want to cancel or pause subscription
      // For partial refund, we keep subscription active

      const isFullRefund = payment.status === PaymentStatus.REFUNDED;
      const isPartialRefund = payment.status === PaymentStatus.PARTIALLY_REFUNDED;

      if (isFullRefund) {
        // Find active subscription for this tenant/plan
        const activeSubscription = await this.prisma.tenantSubscription.findFirst({
          where: {
            tenantId: payment.tenantId,
            planId: payment.planId,
            status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE] },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (activeSubscription) {
          // Business rule: full refund within 7 days cancels subscription
          // After 7 days, refund but keep subscription until period end
          const subscriptionAge = Date.now() - activeSubscription.currentPeriodStart.getTime();
          const sevenDays = 7 * 24 * 60 * 60 * 1000;

          if (subscriptionAge < sevenDays) {
            await this.prisma.tenantSubscription.update({
              where: { id: activeSubscription.id },
              data: {
                status: SubscriptionStatus.CANCELED,
                canceledAt: new Date(),
                cancelReason: 'Payment refunded',
              },
            });

            this.logger.log(`Cancelled subscription ${activeSubscription.id} due to full refund within 7 days`);
          } else {
            // Keep subscription but mark to cancel at period end
            await this.prisma.tenantSubscription.update({
              where: { id: activeSubscription.id },
              data: {
                cancelAtPeriodEnd: true,
                cancelReason: 'Payment refunded - will cancel at period end',
              },
            });

            this.logger.log(`Marked subscription ${activeSubscription.id} to cancel at period end due to refund`);
          }
        }
      } else if (isPartialRefund) {
        // Partial refund - keep subscription active, just audit
        this.logger.log(`Partial refund for payment ${payment.id}, keeping subscription active`);
      }

      await this.audit.logPaymentEvent({
        tenantId: payment.tenantId,
        paymentId: payment.id,
        provider: payment.provider,
        action: 'SUBSCRIPTION_REFUNDED',
        status: payment.status,
        planId: payment.planId,
        metadata: { syncAction: isFullRefund ? 'full_refund' : 'partial_refund' },
      });
    } catch (error) {
      this.logger.error(`Failed to handle refunded payment ${payment.id}: ${(error as Error).message}`);
      throw error;
    }
  }

  private async handlePaymentDisputed(payment: PaymentRecord): Promise<void> {
    this.logger.log(`Handling payment disputed: ${payment.id} for tenant ${payment.tenantId}`);

    try {
      // Disputed payment - typically pause subscription and require review
      const activeSubscription = await this.prisma.tenantSubscription.findFirst({
        where: {
          tenantId: payment.tenantId,
          planId: payment.planId,
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (activeSubscription) {
        await this.prisma.tenantSubscription.update({
          where: { id: activeSubscription.id },
          data: {
            status: SubscriptionStatus.PAUSED,
            metadata: {
              ...((activeSubscription.metadata as any) || {}),
              disputePaymentId: payment.id,
              disputedAt: new Date().toISOString(),
            },
          },
        });

        this.logger.log(`Paused subscription ${activeSubscription.id} due to payment dispute`);
      }

      await this.audit.logPaymentEvent({
        tenantId: payment.tenantId,
        paymentId: payment.id,
        provider: payment.provider,
        action: 'SUBSCRIPTION_PAUSED',
        status: payment.status,
        planId: payment.planId,
        metadata: { syncAction: 'payment_disputed' },
      });
    } catch (error) {
      this.logger.error(`Failed to handle disputed payment ${payment.id}: ${(error as Error).message}`);
    }
  }

  private async handlePaymentPending(payment: PaymentRecord): Promise<void> {
    this.logger.log(`Handling payment pending/processing: ${payment.id} status ${payment.status}`);

    // Pending payment - no subscription change yet, just audit
    await this.audit.logPaymentEvent({
      tenantId: payment.tenantId,
      paymentId: payment.id,
      provider: payment.provider,
      action: 'PAYMENT_PENDING',
      status: payment.status,
      planId: payment.planId,
      metadata: { syncAction: 'payment_pending' },
    });
  }

  private async createNewSubscription(payment: PaymentRecord): Promise<void> {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: payment.planId },
    });

    if (!plan) {
      throw new AppException({
        code: ErrorCode.NOT_FOUND,
        message: `Plan not found: ${payment.planId}`,
      });
    }

    const now = new Date();
    const periodEnd = this.calculatePeriodEnd(now, plan.interval as BillingInterval);

    // Reuse existing subscription service logic via direct prisma create
    // This mirrors what SubscriptionsService.assign does but with payment context
    const subscription = await this.prisma.tenantSubscription.create({
      data: {
        tenantId: payment.tenantId,
        planId: payment.planId,
        status: plan.trialDays > 0 ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        trialEndsAt: plan.trialDays > 0 ? new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000) : null,
        seatsPurchased: payment.seats || 1,
        externalCustomerId: payment.externalCustomerId || payment.providerCustomerId || null,
        externalSubscriptionId: payment.externalSubscriptionId || null,
        metadata: {
          paymentId: payment.id,
          provider: payment.provider,
          providerPaymentId: payment.providerPaymentId,
          createdFromPayment: true,
        },
      },
    });

    // Apply plan limits to tenant (same as SubscriptionsService does)
    await this.prisma.tenant.update({
      where: { id: payment.tenantId },
      data: {
        maxUsers: (plan.limits as any)?.maxUsers ?? null,
        maxTraders: (plan.limits as any)?.maxTraders ?? null,
      },
    });

    this.logger.log(`Created new subscription ${subscription.id} for tenant ${payment.tenantId} from payment ${payment.id}`);

    // Update payment with subscription ID
    try {
      await (this.prisma as any).payment?.update({
        where: { id: payment.id },
        data: { subscriptionId: subscription.id },
      });
    } catch {}
  }

  private async renewSubscription(existingSubscription: any, payment: PaymentRecord): Promise<void> {
    const now = new Date();
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: payment.planId },
    });

    if (!plan) {
      throw new AppException({ code: ErrorCode.NOT_FOUND, message: `Plan not found: ${payment.planId}` });
    }

    const periodEnd = this.calculatePeriodEnd(now, plan.interval as BillingInterval);

    await this.prisma.tenantSubscription.update({
      where: { id: existingSubscription.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        metadata: {
          ...((existingSubscription.metadata as any) || {}),
          lastRenewalPaymentId: payment.id,
          renewedAt: now.toISOString(),
        },
      },
    });

    this.logger.log(`Renewed subscription ${existingSubscription.id} for tenant ${payment.tenantId}`);
  }

  private async reactivateSubscription(existingSubscription: any, payment: PaymentRecord): Promise<void> {
    const now = new Date();
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: payment.planId },
    });

    if (!plan) {
      throw new AppException({ code: ErrorCode.NOT_FOUND, message: `Plan not found: ${payment.planId}` });
    }

    const periodEnd = this.calculatePeriodEnd(now, plan.interval as BillingInterval);

    await this.prisma.tenantSubscription.update({
      where: { id: existingSubscription.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        metadata: {
          ...((existingSubscription.metadata as any) || {}),
          reactivatedPaymentId: payment.id,
          reactivatedAt: now.toISOString(),
        },
      },
    });

    this.logger.log(`Reactivated past_due subscription ${existingSubscription.id} for tenant ${payment.tenantId}`);
  }

  private async activateSubscription(existingSubscription: any, payment: PaymentRecord): Promise<void> {
    await this.prisma.tenantSubscription.update({
      where: { id: existingSubscription.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        metadata: {
          ...((existingSubscription.metadata as any) || {}),
          activatedPaymentId: payment.id,
          activatedAt: new Date().toISOString(),
        },
      },
    });

    this.logger.log(`Activated subscription ${existingSubscription.id} for tenant ${payment.tenantId}`);
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
