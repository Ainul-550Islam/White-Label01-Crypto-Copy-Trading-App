import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../infrastructure/prisma/prisma.module';
import { BillingNotificationsModule } from '../notifications/notifications.module';
import { PaymentConfigService } from './payment.config';
import { PaymentProviderFactory } from './payment-provider.factory';
import { StripeAdapter } from './stripe.adapter';
import { NowPaymentsAdapter } from './nowpayments.adapter';
import { PaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';
import { WebhookSignatureService } from './webhook.signature';
import { WebhookReplayGuard } from './webhook.replay-guard';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { PaymentSubscriptionSyncService } from './payment-subscription-sync.service';
import { PaymentEventsAuditService } from './payment-events.audit';
import { PaymentReconciliationService } from './payment-reconciliation.service';

/**
 * NestJS module wiring for all payment providers, repositories, services,
 * controllers, guards/helpers, configuration, and exports required by
 * the existing billing module.
 *
 * This module integrates with existing:
 *  - Billing plan catalog (PlansService)
 *  - Subscription service (SubscriptionsService)
 *  - Entitlement and limit enforcement
 *  - Tenant and RBAC
 *  - Audit and logging
 *
 * It does NOT duplicate subscription logic or hardcode plan prices.
 * Plans and prices come from existing billing plan/catalog layer.
 *
 * Providers:
 *  - Stripe and NowPayments are adapters behind common abstraction (IPaymentProvider)
 *  - Factory selects configured provider via BILLING_PROVIDER
 *  - Webhook processing is idempotent and replay-safe
 *  - No raw card numbers, CVV, private keys, or payment secrets in logs
 */

@Module({
  imports: [PrismaModule, forwardRef(() => BillingNotificationsModule)],
  controllers: [CheckoutController, WebhookController],
  providers: [
    PaymentConfigService,
    PaymentProviderFactory,
    StripeAdapter,
    NowPaymentsAdapter,
    PaymentRepository,
    PaymentService,
    CheckoutService,
    WebhookSignatureService,
    WebhookReplayGuard,
    WebhookService,
    PaymentSubscriptionSyncService,
    PaymentEventsAuditService,
    PaymentReconciliationService,
  ],
  exports: [
    PaymentConfigService,
    PaymentProviderFactory,
    PaymentRepository,
    PaymentService,
    CheckoutService,
    WebhookService,
    WebhookSignatureService,
    WebhookReplayGuard,
    PaymentSubscriptionSyncService,
    PaymentEventsAuditService,
    PaymentReconciliationService,
    StripeAdapter,
    NowPaymentsAdapter,
  ],
})
export class PaymentsModule {}
