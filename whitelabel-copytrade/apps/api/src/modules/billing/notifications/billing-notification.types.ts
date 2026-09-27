/**
 * Canonical billing notification/event types.
 * Tenant-safe, sanitized payloads, idempotent delivery.
 */

export enum BillingNotificationEventKey {
  PAYMENT_SUCCEEDED = 'PAYMENT_SUCCEEDED',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PAYMENT_EXPIRED = 'PAYMENT_EXPIRED',
  REFUND_SUCCEEDED = 'REFUND_SUCCEEDED',
  REFUND_FAILED = 'REFUND_FAILED',
  INVOICE_CREATED = 'INVOICE_CREATED',
  INVOICE_FINALIZED = 'INVOICE_FINALIZED',
  INVOICE_PAID = 'INVOICE_PAID',
  INVOICE_OVERDUE = 'INVOICE_OVERDUE',
  SUBSCRIPTION_ACTIVATED = 'SUBSCRIPTION_ACTIVATED',
  SUBSCRIPTION_CHANGED = 'SUBSCRIPTION_CHANGED',
  SUBSCRIPTION_CANCELLATION_SCHEDULED = 'SUBSCRIPTION_CANCELLATION_SCHEDULED',
  SUBSCRIPTION_RESUMED = 'SUBSCRIPTION_RESUMED',
  TRIAL_STARTING = 'TRIAL_STARTING',
  TRIAL_ENDING = 'TRIAL_ENDING',
  DUNNING_RETRY = 'DUNNING_RETRY',
  DUNNING_RECOVERED = 'DUNNING_RECOVERED',
  DUNNING_FINAL_FAILURE = 'DUNNING_FINAL_FAILURE',
  USAGE_THRESHOLD_REACHED = 'USAGE_THRESHOLD_REACHED',
  USAGE_OVERAGE_DETECTED = 'USAGE_OVERAGE_DETECTED',
  CUSTOM_DOMAIN_VERIFICATION = 'CUSTOM_DOMAIN_VERIFICATION',
  CUSTOM_DOMAIN_VERIFICATION_FAILED = 'CUSTOM_DOMAIN_VERIFICATION_FAILED',
  WHITE_LABEL_PROVISIONING = 'WHITE_LABEL_PROVISIONING',
  FEE_SETTLEMENT_CREATED = 'FEE_SETTLEMENT_CREATED',
  FEE_SETTLEMENT_FINALIZED = 'FEE_SETTLEMENT_FINALIZED',
  PAYOUT_CREATED = 'PAYOUT_CREATED',
  PAYOUT_SUCCEEDED = 'PAYOUT_SUCCEEDED',
  PAYOUT_FAILED = 'PAYOUT_FAILED',
  SAAS_TENANT_PROVISIONED = 'SAAS_TENANT_PROVISIONED',
  SAAS_PLAN_CHANGED = 'SAAS_PLAN_CHANGED',
}

export enum NotificationChannel {
  EMAIL = 'EMAIL',
  IN_APP = 'IN_APP',
  PUSH = 'PUSH',
  SMS = 'SMS',
  WEBHOOK = 'WEBHOOK',
}

export enum NotificationPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum DeliveryStatus {
  CREATED = 'CREATED',
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  RETRY_SCHEDULED = 'RETRY_SCHEDULED',
  PERMANENT_FAILURE = 'PERMANENT_FAILURE',
  SUPPRESSED = 'SUPPRESSED',
  CANCELLED = 'CANCELLED',
}

export enum NotificationCategory {
  BILLING = 'BILLING',
  DUNNING = 'DUNNING',
  USAGE = 'USAGE',
  SUBSCRIPTION = 'SUBSCRIPTION',
  SECURITY = 'SECURITY',
  SAAS_ADMIN = 'SAAS_ADMIN',
  FEE = 'FEE',
  PAYOUT = 'PAYOUT',
}

export interface NotificationRecipient {
  tenantId: string;
  userId?: string;
  email?: string;
  type: 'tenant_admin' | 'user' | 'platform_operator' | 'beneficiary';
}

export interface SafeNotificationPayload {
  tenantId: string;
  tenantName?: string;
  customerName?: string;
  userId?: string;
  userEmail?: string;
  planName?: string;
  planCode?: string;
  invoiceNumber?: string;
  invoiceId?: string;
  paymentId?: string;
  paymentStatus?: string;
  subscriptionId?: string;
  subscriptionStatus?: string;
  renewalDate?: string;
  trialEndsAt?: string;
  amount?: string;
  currency?: string;
  usagePercentage?: number;
  meterKey?: string;
  limitKey?: string;
  currentUsage?: number;
  maxLimit?: number | null;
  overageQuantity?: number;
  dunningAttempt?: number;
  dunningMaxAttempts?: number;
  nextRetryAt?: string;
  domain?: string;
  whiteLabelState?: string;
  settlementId?: string;
  payoutId?: string;
  payoutStatus?: string;
  supportEmail?: string;
  supportUrl?: string;
  appName?: string;
  locale?: string;
  [key: string]: unknown;
}

export interface BillingNotificationJob {
  id: string;
  tenantId: string;
  userId?: string;
  recipient: NotificationRecipient;
  eventKey: BillingNotificationEventKey;
  channel: NotificationChannel;
  templateKey: string;
  locale: string;
  priority: NotificationPriority;
  category: NotificationCategory;
  deliveryStatus: DeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  providerReference: string | null;
  idempotencyKey: string;
  safePayload: SafeNotificationPayload;
  renderedSubject?: string;
  renderedBody?: string;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
}

export interface WebhookSubscription {
  id: string;
  tenantId: string;
  endpointUrl: string;
  eventTypes: BillingNotificationEventKey[];
  enabled: boolean;
  secretHash: string;
  secretMasked: string;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: string | null;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryAttempt {
  id: string;
  subscriptionId: string;
  tenantId: string;
  eventId: string;
  eventType: BillingNotificationEventKey;
  endpointUrl: string;
  payload: SafeNotificationPayload;
  signature: string;
  timestamp: string;
  status: DeliveryStatus;
  attempt: number;
  providerReference?: string | null;
  failureReason?: string | null;
  nextAttemptAt?: string | null;
  createdAt: string;
}

export const MANDATORY_BILLING_EVENTS: Set<BillingNotificationEventKey> = new Set([
  BillingNotificationEventKey.PAYMENT_SUCCEEDED,
  BillingNotificationEventKey.PAYMENT_FAILED,
  BillingNotificationEventKey.PAYMENT_PENDING,
  BillingNotificationEventKey.REFUND_SUCCEEDED,
  BillingNotificationEventKey.REFUND_FAILED,
  BillingNotificationEventKey.INVOICE_FINALIZED,
  BillingNotificationEventKey.INVOICE_PAID,
  BillingNotificationEventKey.INVOICE_OVERDUE,
  BillingNotificationEventKey.SUBSCRIPTION_CHANGED,
  BillingNotificationEventKey.SUBSCRIPTION_CANCELLATION_SCHEDULED,
  BillingNotificationEventKey.SUBSCRIPTION_RESUMED,
  BillingNotificationEventKey.DUNNING_RETRY,
  BillingNotificationEventKey.DUNNING_FINAL_FAILURE,
  BillingNotificationEventKey.TRIAL_ENDING,
  BillingNotificationEventKey.CUSTOM_DOMAIN_VERIFICATION_FAILED,
]);
