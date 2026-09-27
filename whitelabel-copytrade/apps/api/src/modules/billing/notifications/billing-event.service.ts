import { Injectable, Logger } from '@nestjs/common';
import { BillingNotificationEventKey, SafeNotificationPayload } from './billing-notification.types';
import { BillingNotificationDispatcher } from './billing-notification.dispatcher';
import { NotificationDeliveryService } from './notification-delivery.service';

/**
 * Converts canonical payment/subscription/invoice/usage/dunning/fee events
 * into notification jobs without duplicating business state.
 * Records intent to notify; does NOT declare financial success.
 * Tenant-safe, idempotent source event handling.
 */
@Injectable()
export class BillingEventService {
  private readonly logger = new Logger(BillingEventService.name);

  constructor(
    private readonly dispatcher: BillingNotificationDispatcher,
    private readonly deliveryService: NotificationDeliveryService,
  ) {}

  // Payment events
  async onPaymentSucceeded(params: {
    tenantId: string;
    paymentId: string;
    userId?: string;
    amount: string;
    currency: string;
    planName?: string;
    planCode?: string;
    paymentStatus: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.PAYMENT_SUCCEEDED, params.tenantId, {
      tenantId: params.tenantId,
      paymentId: params.paymentId,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      planName: params.planName,
      planCode: params.planCode,
      paymentStatus: params.paymentStatus,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.paymentId);
  }

  async onPaymentFailed(params: {
    tenantId: string;
    paymentId: string;
    userId?: string;
    amount: string;
    currency: string;
    planName?: string;
    paymentStatus: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.PAYMENT_FAILED, params.tenantId, {
      tenantId: params.tenantId,
      paymentId: params.paymentId,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      planName: params.planName,
      paymentStatus: params.paymentStatus,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.paymentId);
  }

  async onPaymentPending(params: {
    tenantId: string;
    paymentId: string;
    userId?: string;
    amount: string;
    currency: string;
    planName?: string;
    paymentStatus: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.PAYMENT_PENDING, params.tenantId, {
      tenantId: params.tenantId,
      paymentId: params.paymentId,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      planName: params.planName,
      paymentStatus: params.paymentStatus,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.paymentId);
  }

  // Invoice events
  async onInvoiceFinalized(params: {
    tenantId: string;
    invoiceId: string;
    invoiceNumber: string;
    userId?: string;
    amount: string;
    currency: string;
    planName?: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.INVOICE_FINALIZED, params.tenantId, {
      tenantId: params.tenantId,
      invoiceId: params.invoiceId,
      invoiceNumber: params.invoiceNumber,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      planName: params.planName,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.invoiceId);
  }

  async onInvoicePaid(params: {
    tenantId: string;
    invoiceId: string;
    invoiceNumber: string;
    userId?: string;
    amount: string;
    currency: string;
    planName?: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.INVOICE_PAID, params.tenantId, {
      tenantId: params.tenantId,
      invoiceId: params.invoiceId,
      invoiceNumber: params.invoiceNumber,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      planName: params.planName,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.invoiceId);
  }

  // Subscription events
  async onSubscriptionActivated(params: {
    tenantId: string;
    subscriptionId: string;
    userId?: string;
    planName: string;
    planCode: string;
    renewalDate?: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.SUBSCRIPTION_ACTIVATED, params.tenantId, {
      tenantId: params.tenantId,
      subscriptionId: params.subscriptionId,
      userId: params.userId,
      planName: params.planName,
      planCode: params.planCode,
      renewalDate: params.renewalDate,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.subscriptionId);
  }

  async onSubscriptionChanged(params: {
    tenantId: string;
    subscriptionId: string;
    userId?: string;
    planName: string;
    planCode: string;
    renewalDate?: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.SUBSCRIPTION_CHANGED, params.tenantId, {
      tenantId: params.tenantId,
      subscriptionId: params.subscriptionId,
      userId: params.userId,
      planName: params.planName,
      planCode: params.planCode,
      renewalDate: params.renewalDate,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.subscriptionId);
  }

  async onSubscriptionCancellationScheduled(params: {
    tenantId: string;
    subscriptionId: string;
    userId?: string;
    planName: string;
    renewalDate?: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.SUBSCRIPTION_CANCELLATION_SCHEDULED, params.tenantId, {
      tenantId: params.tenantId,
      subscriptionId: params.subscriptionId,
      userId: params.userId,
      planName: params.planName,
      renewalDate: params.renewalDate,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.subscriptionId);
  }

  async onSubscriptionResumed(params: {
    tenantId: string;
    subscriptionId: string;
    userId?: string;
    planName: string;
    renewalDate?: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.SUBSCRIPTION_RESUMED, params.tenantId, {
      tenantId: params.tenantId,
      subscriptionId: params.subscriptionId,
      userId: params.userId,
      planName: params.planName,
      renewalDate: params.renewalDate,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.subscriptionId);
  }

  async onTrialEnding(params: {
    tenantId: string;
    subscriptionId: string;
    userId?: string;
    planName: string;
    trialEndsAt: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.TRIAL_ENDING, params.tenantId, {
      tenantId: params.tenantId,
      subscriptionId: params.subscriptionId,
      userId: params.userId,
      planName: params.planName,
      trialEndsAt: params.trialEndsAt,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.subscriptionId);
  }

  // Dunning events - authoritative is DunningService, we just notify
  async onDunningRetry(params: {
    tenantId: string;
    dunningId: string;
    paymentId: string;
    userId?: string;
    amount: string;
    currency: string;
    dunningAttempt: number;
    dunningMaxAttempts: number;
    nextRetryAt: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.DUNNING_RETRY, params.tenantId, {
      tenantId: params.tenantId,
      paymentId: params.paymentId,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      dunningAttempt: params.dunningAttempt,
      dunningMaxAttempts: params.dunningMaxAttempts,
      nextRetryAt: params.nextRetryAt,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.dunningId);
  }

  async onDunningFinalFailure(params: {
    tenantId: string;
    dunningId: string;
    paymentId: string;
    userId?: string;
    amount: string;
    currency: string;
    dunningMaxAttempts: number;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.DUNNING_FINAL_FAILURE, params.tenantId, {
      tenantId: params.tenantId,
      paymentId: params.paymentId,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      dunningMaxAttempts: params.dunningMaxAttempts,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.dunningId);
  }

  // Usage events - authoritative is UsageAlertService
  async onUsageThresholdReached(params: {
    tenantId: string;
    meterKey: string;
    limitKey: string;
    userId?: string;
    usagePercentage: number;
    currentUsage: number;
    maxLimit: number | null;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.USAGE_THRESHOLD_REACHED, params.tenantId, {
      tenantId: params.tenantId,
      meterKey: params.meterKey,
      limitKey: params.limitKey,
      userId: params.userId,
      usagePercentage: params.usagePercentage,
      currentUsage: params.currentUsage,
      maxLimit: params.maxLimit,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, `${params.meterKey}_${params.limitKey}_${params.usagePercentage}`);
  }

  async onUsageOverageDetected(params: {
    tenantId: string;
    meterKey: string;
    limitKey: string;
    userId?: string;
    currentUsage: number;
    maxLimit: number | null;
    overageQuantity: number;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.USAGE_OVERAGE_DETECTED, params.tenantId, {
      tenantId: params.tenantId,
      meterKey: params.meterKey,
      limitKey: params.limitKey,
      userId: params.userId,
      currentUsage: params.currentUsage,
      maxLimit: params.maxLimit,
      overageQuantity: params.overageQuantity,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, `${params.meterKey}_${params.limitKey}_overage_${params.overageQuantity}`);
  }

  // Custom domain events
  async onCustomDomainVerification(params: {
    tenantId: string;
    domain: string;
    userId?: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.CUSTOM_DOMAIN_VERIFICATION, params.tenantId, {
      tenantId: params.tenantId,
      domain: params.domain,
      userId: params.userId,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.domain);
  }

  async onCustomDomainVerificationFailed(params: {
    tenantId: string;
    domain: string;
    userId?: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.CUSTOM_DOMAIN_VERIFICATION_FAILED, params.tenantId, {
      tenantId: params.tenantId,
      domain: params.domain,
      userId: params.userId,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, `${params.domain}_failed`);
  }

  // Fee settlement events
  async onFeeSettlementFinalized(params: {
    tenantId: string;
    settlementId: string;
    userId?: string;
    amount: string;
    currency: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.FEE_SETTLEMENT_FINALIZED, params.tenantId, {
      tenantId: params.tenantId,
      settlementId: params.settlementId,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.settlementId);
  }

  // Payout events
  async onPayoutSucceeded(params: {
    tenantId: string;
    payoutId: string;
    settlementId: string;
    userId?: string;
    amount: string;
    currency: string;
    payoutStatus: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.PAYOUT_SUCCEEDED, params.tenantId, {
      tenantId: params.tenantId,
      payoutId: params.payoutId,
      settlementId: params.settlementId,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      payoutStatus: params.payoutStatus,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.payoutId);
  }

  async onPayoutFailed(params: {
    tenantId: string;
    payoutId: string;
    settlementId: string;
    userId?: string;
    amount: string;
    currency: string;
    payoutStatus: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.PAYOUT_FAILED, params.tenantId, {
      tenantId: params.tenantId,
      payoutId: params.payoutId,
      settlementId: params.settlementId,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      payoutStatus: params.payoutStatus,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, `${params.payoutId}_failed`);
  }

  // Refund events
  async onRefundSucceeded(params: {
    tenantId: string;
    refundId: string;
    paymentId: string;
    userId?: string;
    amount: string;
    currency: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.REFUND_SUCCEEDED, params.tenantId, {
      tenantId: params.tenantId,
      paymentId: params.paymentId,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    } as any, params.refundId);
  }

  async onRefundFailed(params: {
    tenantId: string;
    refundId: string;
    paymentId: string;
    userId?: string;
    amount: string;
    currency: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.REFUND_FAILED, params.tenantId, {
      tenantId: params.tenantId,
      paymentId: params.paymentId,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    } as any, `${params.refundId}_failed`);
  }

  async onInvoiceCreated(params: {
    tenantId: string;
    invoiceId: string;
    invoiceNumber: string;
    userId?: string;
    amount: string;
    currency: string;
    planName?: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.INVOICE_CREATED, params.tenantId, {
      tenantId: params.tenantId,
      invoiceId: params.invoiceId,
      invoiceNumber: params.invoiceNumber,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      planName: params.planName,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.invoiceId);
  }

  async onInvoiceOverdue(params: {
    tenantId: string;
    invoiceId: string;
    invoiceNumber: string;
    userId?: string;
    amount: string;
    currency: string;
    planName?: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.INVOICE_OVERDUE, params.tenantId, {
      tenantId: params.tenantId,
      invoiceId: params.invoiceId,
      invoiceNumber: params.invoiceNumber,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      planName: params.planName,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, `${params.invoiceId}_overdue`);
  }

  async onTrialStarting(params: {
    tenantId: string;
    subscriptionId: string;
    userId?: string;
    planName: string;
    trialEndsAt: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.TRIAL_STARTING, params.tenantId, {
      tenantId: params.tenantId,
      subscriptionId: params.subscriptionId,
      userId: params.userId,
      planName: params.planName,
      trialEndsAt: params.trialEndsAt,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, `${params.subscriptionId}_trial_start`);
  }

  async onDunningRecovered(params: {
    tenantId: string;
    dunningId: string;
    paymentId: string;
    userId?: string;
    amount: string;
    currency: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.DUNNING_RECOVERED, params.tenantId, {
      tenantId: params.tenantId,
      paymentId: params.paymentId,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, `${params.dunningId}_recovered`);
  }

  async onWhiteLabelProvisioning(params: {
    tenantId: string;
    userId?: string;
    whiteLabelState: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.WHITE_LABEL_PROVISIONING, params.tenantId, {
      tenantId: params.tenantId,
      userId: params.userId,
      whiteLabelState: params.whiteLabelState,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, `whitelabel_${params.tenantId}_${Date.now()}`);
  }

  async onFeeSettlementCreated(params: {
    tenantId: string;
    settlementId: string;
    userId?: string;
    amount: string;
    currency: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.FEE_SETTLEMENT_CREATED, params.tenantId, {
      tenantId: params.tenantId,
      settlementId: params.settlementId,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.settlementId);
  }

  async onPayoutCreated(params: {
    tenantId: string;
    payoutId: string;
    settlementId: string;
    userId?: string;
    amount: string;
    currency: string;
    payoutStatus: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.PAYOUT_CREATED, params.tenantId, {
      tenantId: params.tenantId,
      payoutId: params.payoutId,
      settlementId: params.settlementId,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      payoutStatus: params.payoutStatus,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, params.payoutId);
  }

  async onSaasTenantProvisioned(params: {
    tenantId: string;
    userId?: string;
    planName?: string;
    planCode?: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.SAAS_TENANT_PROVISIONED, params.tenantId, {
      tenantId: params.tenantId,
      userId: params.userId,
      planName: params.planName,
      planCode: params.planCode,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, `saas_provision_${params.tenantId}`);
  }

  async onSaasPlanChanged(params: {
    tenantId: string;
    userId?: string;
    planName: string;
    planCode: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.SAAS_PLAN_CHANGED, params.tenantId, {
      tenantId: params.tenantId,
      userId: params.userId,
      planName: params.planName,
      planCode: params.planCode,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, `saas_plan_${params.tenantId}_${Date.now()}`);
  }

  async onPaymentExpired(params: {
    tenantId: string;
    paymentId: string;
    userId?: string;
    amount: string;
    currency: string;
    planName?: string;
    paymentStatus: string;
    customerName?: string;
    tenantName?: string;
    supportEmail?: string;
    appName?: string;
    locale?: string;
  }): Promise<void> {
    await this.dispatchEvent(BillingNotificationEventKey.PAYMENT_EXPIRED, params.tenantId, {
      tenantId: params.tenantId,
      paymentId: params.paymentId,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      planName: params.planName,
      paymentStatus: params.paymentStatus,
      customerName: params.customerName,
      tenantName: params.tenantName,
      supportEmail: params.supportEmail,
      appName: params.appName,
      locale: params.locale,
    }, `${params.paymentId}_expired`);
  }

  public async dispatchEvent(eventKey: BillingNotificationEventKey, tenantId: string, payload: SafeNotificationPayload, sourceId: string): Promise<void> {
    try {
      // Sanitize payload
      const safePayload = this.sanitizePayload(payload);

      // Dispatch via dispatcher -> delivery service
      await this.dispatcher.dispatch({
        eventKey,
        tenantId,
        safePayload,
        sourceId,
      });

      this.logger.log(`Billing event dispatched event=${eventKey} tenant=${tenantId} source=${sourceId}`);
    } catch (e) {
      this.logger.warn(`Failed to dispatch billing event ${eventKey} tenant=${tenantId}: ${(e as Error).message}`);
      // Never throw - notification failure must not rollback business operation
    }
  }

  private sanitizePayload(payload: SafeNotificationPayload): SafeNotificationPayload {
    const forbidden = ['secret', 'privateKey', 'apiKey', 'password', 'exchangeSecret', 'providerSecret', 'card', 'cvv', 'token', 'accessToken', 'credentials', 'bankAccount', 'walletKey'];
    const safe: any = {};
    for (const [key, value] of Object.entries(payload)) {
      const lowerKey = key.toLowerCase();
      if (forbidden.some((f) => lowerKey.includes(f.toLowerCase()))) {
        safe[key] = '[REDACTED]';
      } else {
        safe[key] = value;
      }
    }
    return safe as SafeNotificationPayload;
  }
}
