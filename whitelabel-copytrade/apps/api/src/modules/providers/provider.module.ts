/**
 * Provider Module
 * Wires shared provider services and adapters into existing Billing, Payments,
 * Exchanges, Compliance, Security, Custody, Notifications, Fees, Operations,
 * Client Lifecycle, and other domain modules using forwardRef only where necessary.
 *
 * Architecture:
 * Customer / Operator
 *         ↓
 * Existing Domain Service
 *         ↓
 * Existing Provider Interface / Factory
 *         ↓
 * Production Provider Control Layer (this module)
 *         ↓
 * Concrete Adapter
 *         ↓
 * External Provider
 *         ↓
 * Provider Truth
 *         ↓
 * Observation / Webhook
 *         ↓
 * Existing Domain Service
 *         ↓
 * Reconciliation
 *         ↓
 * Operations
 *         ↓
 * Audit
 *
 * For trading:
 * Strategy → Risk → Compliance → OMS → Execution Safety → Exchange Provider Adapter → Exchange → ACK/Fill → OMS → Portfolio Accounting
 *
 * For billing:
 * Checkout → Payment Service → Stripe/NOWPayments Adapter → Provider → Webhook → Payment Service → Finance/Invoice/Subscription
 *
 * For compliance:
 * Client Lifecycle → Compliance → KYC/AML Adapter → Provider → Verified Observation → Compliance Decision → Risk/Account Lifecycle
 *
 * For custody:
 * Funding/Withdrawal → Client Lifecycle → Compliance/Risk/Security → Custody → Custody Adapter → Blockchain/Custodian → Transaction Evidence → Confirmation/Finality → Settlement → Finance/Portfolio Accounting
 */

import { Module, forwardRef } from '@nestjs/common';
import { ProviderController } from './provider.controller';
import { ProviderPolicyService } from './provider-policy.service';
import { ProviderHealthService } from './provider-health.service';
import { ProviderRequestService } from './provider-request.service';
import { ProviderReconciliationService } from './provider-reconciliation.service';
import { ProviderWebhookService } from './provider-webhook.service';
import { ProviderObservationService } from './provider-observation.service';

// Adapters
import { StripeProductionAdapter } from './adapters/payment/stripe.adapter';
import { NowPaymentsProductionAdapter } from './adapters/payment/nowpayments.adapter';
import { BinanceProductionAdapter } from './adapters/exchange/binance.adapter';
import { BybitProductionAdapter } from './adapters/exchange/bybit.adapter';
import { OkxProductionAdapter } from './adapters/exchange/okx.adapter';
import { KrakenProductionAdapter } from './adapters/exchange/kraken.adapter';
import { CoinbaseProductionAdapter } from './adapters/exchange/coinbase.adapter';
import { KycProductionAdapter } from './adapters/kyc/kyc.adapter';
import { AmlProductionAdapter } from './adapters/aml/aml.adapter';
import { PayoutProductionAdapter } from './adapters/payout/payout.adapter';
import { CustodyProductionAdapter } from './adapters/custody/custody.adapter';
import { NotificationProductionAdapter } from './adapters/notification/notification.adapter';

@Module({
  controllers: [ProviderController],
  providers: [
    ProviderPolicyService,
    ProviderRequestService,
    ProviderHealthService,
    ProviderReconciliationService,
    ProviderWebhookService,
    ProviderObservationService,
    // Payment adapters
    StripeProductionAdapter,
    NowPaymentsProductionAdapter,
    // Exchange adapters
    BinanceProductionAdapter,
    BybitProductionAdapter,
    OkxProductionAdapter,
    KrakenProductionAdapter,
    CoinbaseProductionAdapter,
    // Compliance adapters
    KycProductionAdapter,
    AmlProductionAdapter,
    // Payout
    PayoutProductionAdapter,
    // Custody
    CustodyProductionAdapter,
    // Notification
    NotificationProductionAdapter,
  ],
  exports: [
    ProviderPolicyService,
    ProviderRequestService,
    ProviderHealthService,
    ProviderReconciliationService,
    ProviderWebhookService,
    ProviderObservationService,
    StripeProductionAdapter,
    NowPaymentsProductionAdapter,
    BinanceProductionAdapter,
    BybitProductionAdapter,
    OkxProductionAdapter,
    KrakenProductionAdapter,
    CoinbaseProductionAdapter,
    KycProductionAdapter,
    AmlProductionAdapter,
    PayoutProductionAdapter,
    CustodyProductionAdapter,
    NotificationProductionAdapter,
  ],
})
export class ProviderModule {}
