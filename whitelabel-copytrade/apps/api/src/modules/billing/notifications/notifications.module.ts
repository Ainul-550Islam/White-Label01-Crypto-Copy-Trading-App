import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../infrastructure/prisma/prisma.module';
import { BillingNotificationAuditService } from './billing-notification.audit';
import { NotificationJobRepository } from './notification-job.repository';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationProviderFactory } from './notification-provider.factory';
import { EmailNotificationProvider } from './email-notification.provider';
import { InAppNotificationService } from './in-app-notification.service';
import { PushNotificationService } from './push-notification.service';
import { BillingWebhookNotificationService } from './billing-webhook-notification.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationWorkerService } from './notification-worker.service';
import { BillingNotificationDispatcher } from './billing-notification.dispatcher';
import { BillingEventService } from './billing-event.service';
import { NotificationReconciliationService } from './notification-reconciliation.service';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { BillingNotificationController } from './billing-notification.controller';
import { InvoiceDeliveryService } from './invoice-delivery.service';
import { SubscriptionEventService } from './subscription-event.service';
import { DunningNotificationService } from './dunning-notification.service';

/**
 * Wiring all notification services, repos, providers, worker, audit, reconciliation.
 * Integrates BillingModule/PaymentsModule/FinanceModule/UsageModule/FeesModule/user/tenant/existing notification infra.
 * Includes controller for history/inbox/preferences/webhooks/worker/reconciliation (tenant-isolated, no secrets plaintext).
 * Includes scheduler for automatic worker processing (30s), stuck detection (5m), reconciliation (1h).
 */
@Module({
  imports: [PrismaModule],
  controllers: [BillingNotificationController],
  providers: [
    // Audit
    BillingNotificationAuditService,

    // Repositories
    NotificationJobRepository,

    // Templates and preferences
    NotificationTemplateService,
    NotificationPreferenceService,

    // Providers
    EmailNotificationProvider,
    InAppNotificationService,
    PushNotificationService,
    BillingWebhookNotificationService,
    NotificationProviderFactory,

    // Core delivery
    NotificationDeliveryService,
    NotificationWorkerService,
    BillingNotificationDispatcher,
    BillingEventService,
    NotificationReconciliationService,
    NotificationSchedulerService,
    InvoiceDeliveryService,
    SubscriptionEventService,
    DunningNotificationService,
  ],
  exports: [
    BillingNotificationAuditService,
    NotificationJobRepository,
    NotificationTemplateService,
    NotificationPreferenceService,
    NotificationProviderFactory,
    EmailNotificationProvider,
    InAppNotificationService,
    PushNotificationService,
    BillingWebhookNotificationService,
    NotificationDeliveryService,
    NotificationWorkerService,
    BillingNotificationDispatcher,
    BillingEventService,
    NotificationReconciliationService,
    NotificationSchedulerService,
    InvoiceDeliveryService,
    SubscriptionEventService,
    DunningNotificationService,
  ],
})
export class BillingNotificationsModule {}
