import { Module } from '@nestjs/common';

import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { PlansController } from './plans.controller';
import { SubscriptionsController } from './subscriptions.controller';
import { EnforcementModule } from './enforcement/enforcement.module';
import { PaymentsModule } from './payments/payments.module';
import { FinanceModule } from './finance/finance.module';
import { PortalModule } from './portal/portal.module';
import { SaasAdminModule } from './saas-admin/saas-admin.module';
import { FeesModule } from './fees/fees.module';
import { UsageModule } from './usage/usage.module';
import { BillingNotificationsModule } from './notifications/notifications.module';
import { AnalyticsModule } from './analytics/analytics.module';

/**
 * Subscription management.
 *
 * Part 1 owns the plan catalogue, tenant subscription lifecycle and the
 * entitlement checks that other modules rely on. Payment capture is delegated
 * to an external provider behind `BILLING_PROVIDER`; the provider adapters and
 * webhook ingestion land with the commercial work in a later part, which is why
 * no card data or provider secret ever touches this codebase.
 *
 * Part 2 adds the runtime enforcement layer:
 *  - EnforcementModule provides atomic quota enforcement, feature guards,
 *    rate-limit guards, websocket guards, and per-scope limit guards for:
 *    maxUsers, maxTraders, maxFollowersPerTrader, maxExchangeAccountsPerUser,
 *    maxCopySubscriptionsPerFollower, maxApiRequestsPerMinute, websocketConnections,
 *    customDomain, whiteLabelMobileApp, prioritySupport.
 *
 * Part 4 adds Invoicing, Billing Ledger, Refunds, Tax/VAT, Dunning, and Billing Settlement Foundation:
 *  - FinanceModule provides invoice generation, tax calculation, ledger double-entry,
 *    refund processing, dunning management, billing customer profiles, and reconciliation
 *  - Payment SUCCEEDED -> Invoice Generation -> Tax/VAT -> Finalization -> Ledger -> TenantSubscription
 *  - Refund: Payment -> Validation -> Provider Refund -> Record -> Payment Update -> Invoice Adjustment -> Ledger Reversal -> Audit
 *  - Failed Payment: Payment FAILED -> Dunning -> Retry Window -> Recovered OR Final Failure -> Subscription/Access Action -> Audit+Reconciliation
 *  - Money layer: Decimal-safe minor-unit arithmetic, no floating for ledger, rounding modes
 *  - Invoice: DRAFT/OPEN/FINALIZED/PAID/VOID/PARTIALLY_PAID/REFUNDED/PARTIALLY_REFUNDED/UNCOLLECTIBLE
 *  - Ledger: double-entry debit/credit, balanced validation, append-only immutable, idempotent
 *  - Tax: jurisdiction/taxId/rate/category/exemption/reverse-charge, configurable policy/provider
 *  - Refund: full/partial, never exceed refundable, concurrency-safe, provider confirmation required
 *  - Dunning: attempt tracking, grace period, retry scheduling, recovery/final failure handling
 *  - Billing Customer: normalized profile, tenant isolation, no duplicate auth identity
 *  - Reconciliation: cross-check payment<->invoice<->subscription<->refund<->tax<->ledger
 *  - Finance Audit: structured immutable audit, safe metadata, never logs secrets
 *
 * Part 5 adds Customer Billing Portal, Pricing, Plan Comparison, Checkout Flow, Subscription Management, Invoice History, Payment History:
 *  - PortalModule aggregates canonical data from PlansService/SubscriptionsService/PaymentService/InvoiceRepository/BillingCustomerService/Enforcement
 *  - Billing Dashboard → Current Subscription → Plan Comparison → Select Plan → Checkout → Provider → Verified Payment → Subscription Update → Entitlements → Invoice → History
 *  - UI receives plan/price/features/limits from canonical APIs, never hardcoded
 *  - Payment completion confirmed by backend/provider state, never redirect alone
 *  - All actions tenant-scoped, RBAC preserved, no secrets exposed
 *  - Usage summary matches enforcement limits exactly
 *
 * Part 6 adds SaaS Admin Control Plane, Tenant Provisioning, Plan-Gated White-Label, Branding, Custom Domains, Commercial Feature Management:
 *  - SaasAdminModule provides tenant list/detail/provisioning, plan assignment/change via canonical services, feature access from enforcement, branding via existing TenantBrandingService with sanitization, custom domain with entitlement check + verification, white-label gated by whiteLabelMobileApp entitlement
 *  - Tenant → Provision → Assign Plan → Subscription/Billing → Entitlements/Limits → Branding → Custom Domain → White-Label → Auditable State
 *  - No second billing or entitlement system, no direct planId mutation, no hardcoded pricing, no secret exposure
 *  - All commercial features dynamically entitlement-driven via EnforcementService
 *
 * Part 7 adds Platform Fees, Performance Fees, Revenue Settlement, Trader/Follower Fee Accrual, Payout Foundation:
 *  - FeesModule provides fee policy resolution from canonical SubscriptionPlan.platformFeeBps/performanceFeeBps, Decimal-safe calculator, idempotent accrual, ledger posting via existing BillingLedgerService, settlement grouping, payout with provider confirmation
 *  - Source Amount → Canonical Fee Policy → Precise Calculation → Immutable Accrual → Existing Ledger → Settlement → Confirmed Payout → Audit → Reconciliation
 *  - Supports PLATFORM_FEE and PERFORMANCE_FEE using existing fields, no hardcoded percentages, no second PnL engine
 *  - All financial ops idempotent, concurrency-safe, auditable, tenant-scoped, no secrets in logs
 *  - Payout provider abstraction with explicit config error if not configured, no fake success
 *
 * Part 8 adds Durable SaaS Usage Metering, Aggregation, Overage Tracking, Quota Analytics, Usage Events, Commercial Usage Foundation:
 *  - UsageModule provides durable metering around Part 2 enforcement: record usage after successful business ops, deduplicate events, period buckets, aggregation hourly/daily/monthly/billing-period, quota snapshots combining plan limits + metered usage, analytics trends/utilization/top meters/limit pressure/overage exposure, threshold alerts with cooldown, safe exports JSON/CSV, reconciliation runtime vs durable drift detection
 *  - Runtime Action → Enforcement Decision → Canonical Usage Event → Idempotent Meter → Durable Bucket → Period Aggregation → Quota Snapshot → Analytics → Alert/Overage → Export/Reconciliation
 *  - Enforcement remains authoritative for ALLOW/DENY, metering records what actually happened, no duplicate counters, no hardcoded limits, no invented overage pricing, tenant-scoped, atomic, idempotent
 *
 * Part 9 adds Billing Notifications, Dunning Notifications, Invoice Delivery, Usage Alerts, Subscription Events, Reliable Customer Event Delivery:
 *  - BillingNotificationsModule provides event conversion from canonical billing sources, template resolution, preference enforcement, persistent jobs, worker retry, provider adapters, webhook outbound, audit, reconciliation
 *  - Canonical Event → BillingEventService → Dispatcher → Template+Locale → Preference → Persistent Job → Worker → Provider → Delivery Result → Audit+Retry/Reconciliation
 *  - Events: payment success/pending/failed/expired, refund succeeded/failed, invoice created/finalized/paid/overdue, subscription activated/changed/cancellation scheduled/resumed, trial starting/ending, dunning retry/recovered/final failure, usage threshold/overage, custom-domain verification/failed, white-label provisioning, fee settlement, payout status, SaaS admin
 *  - Mandatory billing notifications cannot be disabled for EMAIL/IN_APP, optional respects user preferences
 *  - Templates use structured data from canonical billing services, no hardcoded Basic/Standard/Premium prices, no secrets
 *  - Providers: SMTP email via existing infra, in-app via existing notification persistence, push via existing mobile infra, webhook with signed event ID/type/timestamp/safe payload/signature/replay protection/retry/ownership isolation
 *  - Retry: exponential backoff, max attempts per channel, temporary vs permanent failure classification, stuck-job detection, no infinite retries, never SENT before provider acceptance
 *  - Tenant isolation every preference/notification/webhook/history/status, idempotent duplicate prevention, sanitized payloads
 *  - Notifications communication only, never authority for payment/subscription/entitlement/invoice state, never mark success because notification delivered
 *  - Dunning authoritative is DunningService, UsageAlert authoritative is UsageAlertService, invoice delivery safe totals+access link no internal paths
 *
 * Part 10 adds SaaS Revenue Analytics, MRR/ARR, ARR/MRR Trends, Customer Churn, Subscription Analytics, Billing Health, Revenue Reporting, and SaaS Finance Dashboard:
 *  - AnalyticsModule provides read-only analytics pipeline from canonical billing/subscription/payment/ledger/usage data
 *  - Canonical Subscription + Payment + Invoice + Ledger + Refund + Fee + Usage → Analytics Engine → MRR/ARR/Revenue/Cashflow → Churn/Retention/Cohorts → Plan Performance → Billing Health → Customer Analytics → Financial Reports → Reconciliation
 *  - MRR: MONTHLY=price, QUARTERLY=price/3, YEARLY=price/12, LIFETIME excluded unless policy says recurring, Decimal-safe
 *  - ARR: MONTHLY×12, QUARTERLY×4, YEARLY×1, LIFETIME excluded unless configured, canonical plan price
 *  - Revenue vs Cash distinction: Invoice ≠ Cash, Payment = collected cash evidence, Ledger = financial record, separate metrics
 *  - Refunds: preserve gross/refund/net separate, fee revenue distinct, tax distinct, no hardcoded Basic/Standard/Premium values
 *  - Churn: explicit definitions, voluntary vs failed-payment vs expiration, customer vs revenue churn separated, deterministic
 *  - Cohorts: explicit definition (SIGNUP_MONTH, FIRST_SUBSCRIPTION_MONTH, FIRST_PAID_MONTH), retention matrix, no mixing
 *  - Currency: never silently sum USD+EUR+BTC, require specific currency or return separate buckets, no invented FX rates
 *  - Tenant isolation: customer analytics tenant-scoped, platform analytics PLATFORM_MANAGE RBAC, no cross-tenant leakage
 *  - Cache: read-through Redis, key includes scope/metric/period/currency/filters, TTL configurable, fallback to source, never source of truth
 *  - Reconciliation: cross-check Subscription↔MRR/ARR↔Invoice↔Payment↔Refund↔Ledger↔Fee↔Revenue, detect drift with severity/category/expected/detected
 *  - All analytics read-only, no mutation, historical records immutable, Decimal-safe minor-unit arithmetic
 *
 * Part 3 adds SaaS checkout, payment providers, webhooks, and payment state management:
 *  - PaymentsModule provides Stripe and NowPayments adapters behind common abstraction
 *  - CheckoutService creates provider checkout from canonical billing plan/catalog
 *  - Webhook processing is idempotent and replay-safe with signature verification
 *  - PaymentSubscriptionSyncService reuses existing TenantSubscription lifecycle
 *  - No hardcoded plan prices - all from existing plan catalog
 *  - No second subscription source of truth
 *  - Never stores raw card numbers, CVV, private keys in logs
 *
 * Critical invariants:
 *  - No hardcoded plan names or numeric limits — all resolved from plan catalog
 *  - Atomic Lua operations prevent race-condition over-allocation (Part 2)
 *  - Provider adapters behind factory using BILLING_PROVIDER config (Part 3)
 *  - Webhook replay protection via provider event ID (Part 3)
 *  - Valid state transitions enforced (Part 3)
 *  - Deterministic, machine-readable decisions
 *  - No secrets in audit logs or error messages
 */
@Module({
  imports: [EnforcementModule, PaymentsModule, FinanceModule, PortalModule, SaasAdminModule, FeesModule, UsageModule, BillingNotificationsModule, AnalyticsModule],
  controllers: [PlansController, SubscriptionsController],
  providers: [PlansService, SubscriptionsService],
  exports: [PlansService, SubscriptionsService, EnforcementModule, PaymentsModule, FinanceModule, PortalModule, SaasAdminModule, FeesModule, UsageModule, BillingNotificationsModule, AnalyticsModule],
})
export class BillingModule {}
