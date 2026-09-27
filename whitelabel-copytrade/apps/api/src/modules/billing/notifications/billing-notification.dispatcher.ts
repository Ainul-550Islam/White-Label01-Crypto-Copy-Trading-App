import { Injectable, Logger } from '@nestjs/common';
import {
  BillingNotificationEventKey,
  NotificationChannel,
  NotificationPriority,
  NotificationCategory,
  MANDATORY_BILLING_EVENTS,
  SafeNotificationPayload,
} from './billing-notification.types';
import { NotificationDeliveryService } from './notification-delivery.service';

/**
 * Maps canonical billing events to template/recipient/channel/priority/mandatory/optional/idempotency/payload builder.
 * No billing state update, notification intent only.
 */

interface DispatchInput {
  eventKey: BillingNotificationEventKey;
  tenantId: string;
  safePayload: SafeNotificationPayload;
  sourceId: string;
}

interface ChannelMapping {
  channels: NotificationChannel[];
  priority: NotificationPriority;
  category: NotificationCategory;
  templateKey: string;
  mandatory: boolean;
}

@Injectable()
export class BillingNotificationDispatcher {
  private readonly logger = new Logger(BillingNotificationDispatcher.name);

  private readonly eventChannelMap: Record<BillingNotificationEventKey, ChannelMapping> = {
    [BillingNotificationEventKey.PAYMENT_SUCCEEDED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.BILLING,
      templateKey: 'payment_succeeded',
      mandatory: true,
    },
    [BillingNotificationEventKey.PAYMENT_PENDING]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.NORMAL,
      category: NotificationCategory.BILLING,
      templateKey: 'payment_pending',
      mandatory: true,
    },
    [BillingNotificationEventKey.PAYMENT_FAILED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP, NotificationChannel.PUSH],
      priority: NotificationPriority.CRITICAL,
      category: NotificationCategory.BILLING,
      templateKey: 'payment_failed',
      mandatory: true,
    },
    [BillingNotificationEventKey.PAYMENT_EXPIRED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.BILLING,
      templateKey: 'payment_failed',
      mandatory: false,
    },
    [BillingNotificationEventKey.REFUND_SUCCEEDED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.BILLING,
      templateKey: 'payment_succeeded',
      mandatory: true,
    },
    [BillingNotificationEventKey.REFUND_FAILED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.BILLING,
      templateKey: 'payment_failed',
      mandatory: true,
    },
    [BillingNotificationEventKey.INVOICE_CREATED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.NORMAL,
      category: NotificationCategory.BILLING,
      templateKey: 'invoice_finalized',
      mandatory: false,
    },
    [BillingNotificationEventKey.INVOICE_FINALIZED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.BILLING,
      templateKey: 'invoice_finalized',
      mandatory: true,
    },
    [BillingNotificationEventKey.INVOICE_PAID]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.BILLING,
      templateKey: 'invoice_paid',
      mandatory: true,
    },
    [BillingNotificationEventKey.INVOICE_OVERDUE]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP, NotificationChannel.PUSH],
      priority: NotificationPriority.CRITICAL,
      category: NotificationCategory.BILLING,
      templateKey: 'invoice_finalized',
      mandatory: true,
    },
    [BillingNotificationEventKey.SUBSCRIPTION_ACTIVATED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.SUBSCRIPTION,
      templateKey: 'subscription_activated',
      mandatory: false,
    },
    [BillingNotificationEventKey.SUBSCRIPTION_CHANGED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.SUBSCRIPTION,
      templateKey: 'subscription_changed',
      mandatory: true,
    },
    [BillingNotificationEventKey.SUBSCRIPTION_CANCELLATION_SCHEDULED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.SUBSCRIPTION,
      templateKey: 'subscription_cancellation_scheduled',
      mandatory: true,
    },
    [BillingNotificationEventKey.SUBSCRIPTION_RESUMED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.SUBSCRIPTION,
      templateKey: 'subscription_resumed',
      mandatory: true,
    },
    [BillingNotificationEventKey.TRIAL_STARTING]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.NORMAL,
      category: NotificationCategory.SUBSCRIPTION,
      templateKey: 'subscription_activated',
      mandatory: false,
    },
    [BillingNotificationEventKey.TRIAL_ENDING]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP, NotificationChannel.PUSH],
      priority: NotificationPriority.CRITICAL,
      category: NotificationCategory.SUBSCRIPTION,
      templateKey: 'trial_ending',
      mandatory: true,
    },
    [BillingNotificationEventKey.DUNNING_RETRY]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.DUNNING,
      templateKey: 'dunning_retry',
      mandatory: true,
    },
    [BillingNotificationEventKey.DUNNING_RECOVERED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.DUNNING,
      templateKey: 'payment_succeeded',
      mandatory: false,
    },
    [BillingNotificationEventKey.DUNNING_FINAL_FAILURE]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP, NotificationChannel.PUSH],
      priority: NotificationPriority.CRITICAL,
      category: NotificationCategory.DUNNING,
      templateKey: 'dunning_final_failure',
      mandatory: true,
    },
    [BillingNotificationEventKey.USAGE_THRESHOLD_REACHED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.USAGE,
      templateKey: 'usage_threshold_reached',
      mandatory: true,
    },
    [BillingNotificationEventKey.USAGE_OVERAGE_DETECTED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.USAGE,
      templateKey: 'usage_overage_detected',
      mandatory: true,
    },
    [BillingNotificationEventKey.CUSTOM_DOMAIN_VERIFICATION]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.NORMAL,
      category: NotificationCategory.SAAS_ADMIN,
      templateKey: 'custom_domain_verification',
      mandatory: false,
    },
    [BillingNotificationEventKey.CUSTOM_DOMAIN_VERIFICATION_FAILED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.SAAS_ADMIN,
      templateKey: 'custom_domain_verification_failed',
      mandatory: true,
    },
    [BillingNotificationEventKey.WHITE_LABEL_PROVISIONING]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.NORMAL,
      category: NotificationCategory.SAAS_ADMIN,
      templateKey: 'custom_domain_verification',
      mandatory: false,
    },
    [BillingNotificationEventKey.FEE_SETTLEMENT_CREATED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.NORMAL,
      category: NotificationCategory.FEE,
      templateKey: 'fee_settlement_finalized',
      mandatory: false,
    },
    [BillingNotificationEventKey.FEE_SETTLEMENT_FINALIZED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.FEE,
      templateKey: 'fee_settlement_finalized',
      mandatory: false,
    },
    [BillingNotificationEventKey.PAYOUT_CREATED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.NORMAL,
      category: NotificationCategory.PAYOUT,
      templateKey: 'payout_succeeded',
      mandatory: false,
    },
    [BillingNotificationEventKey.PAYOUT_SUCCEEDED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.PAYOUT,
      templateKey: 'payout_succeeded',
      mandatory: false,
    },
    [BillingNotificationEventKey.PAYOUT_FAILED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.CRITICAL,
      category: NotificationCategory.PAYOUT,
      templateKey: 'payout_failed',
      mandatory: false,
    },
    [BillingNotificationEventKey.SAAS_TENANT_PROVISIONED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.SAAS_ADMIN,
      templateKey: 'subscription_activated',
      mandatory: false,
    },
    [BillingNotificationEventKey.SAAS_PLAN_CHANGED]: {
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      category: NotificationCategory.SAAS_ADMIN,
      templateKey: 'subscription_changed',
      mandatory: false,
    },
  };

  constructor(private readonly deliveryService: NotificationDeliveryService) {}

  async dispatch(input: DispatchInput): Promise<void> {
    const mapping = this.eventChannelMap[input.eventKey];
    if (!mapping) {
      this.logger.warn(`No channel mapping for event ${input.eventKey}`);
      return;
    }

    const isMandatory = MANDATORY_BILLING_EVENTS.has(input.eventKey) || mapping.mandatory;

    // Build idempotency key from canonical event: tenant + event + sourceId
    const baseIdempotency = `billing_notif_${input.tenantId}_${input.eventKey}_${input.sourceId}`;

    for (const channel of mapping.channels) {
      const idempotencyKey = `${baseIdempotency}_${channel}`;

      try {
        await this.deliveryService.requestDelivery({
          tenantId: input.tenantId,
          userId: input.safePayload.userId,
          eventKey: input.eventKey,
          channel,
          templateKey: mapping.templateKey,
          priority: mapping.priority,
          category: mapping.category,
          safePayload: input.safePayload,
          idempotencyKey,
          isMandatory,
          locale: (input.safePayload.locale as string) || 'en',
        });

        this.logger.log(`Dispatched billing notification event=${input.eventKey} tenant=${input.tenantId} channel=${channel} mandatory=${isMandatory} idempotency=${idempotencyKey}`);
      } catch (e) {
        this.logger.warn(`Failed to dispatch ${input.eventKey} channel=${channel} tenant=${input.tenantId}: ${(e as Error).message}`);
      }
    }

    // Also trigger webhook delivery for eligible events (webhook channel is separate from direct provider)
    // Webhook delivery is handled via BillingWebhookNotificationService triggered separately
    // But we still create a WEBHOOK channel job for audit/reconciliation
    try {
      const webhookIdempotency = `${baseIdempotency}_WEBHOOK`;
      await this.deliveryService.requestDelivery({
        tenantId: input.tenantId,
        userId: input.safePayload.userId,
        eventKey: input.eventKey,
        channel: NotificationChannel.WEBHOOK,
        templateKey: mapping.templateKey,
        priority: mapping.priority,
        category: mapping.category,
        safePayload: input.safePayload,
        idempotencyKey: webhookIdempotency,
        isMandatory: false,
        locale: (input.safePayload.locale as string) || 'en',
      });
    } catch {}
  }
}
