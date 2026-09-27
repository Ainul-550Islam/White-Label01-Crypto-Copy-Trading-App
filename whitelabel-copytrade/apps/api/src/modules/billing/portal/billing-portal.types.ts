import type { BillingInterval, SubscriptionStatus, PlanLimits } from '@wlct/shared-types';

/**
 * Shared customer billing portal domain models.
 * Aggregates canonical data without duplicating plan/payment/subscription definitions.
 * All data originates from existing Part 1-4 services.
 */

export interface PortalCurrentPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  interval: BillingInterval;
  trialDays: number;
  limits: PlanLimits;
  features: string[];
  isActive: boolean;
  sortOrder: number;
}

export interface PortalAvailablePlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  interval: BillingInterval;
  trialDays: number;
  limits: PlanLimits;
  features: string[];
  isActive: boolean;
  sortOrder: number;
  isCurrent: boolean;
  upgradeEligible: boolean;
  downgradeEligible: boolean;
  intervalChangeEligible: boolean;
}

export interface PortalSubscriptionState {
  id: string | null;
  tenantId: string;
  planId: string | null;
  planCode: string | null;
  planName: string | null;
  status: SubscriptionStatus | null;
  interval: BillingInterval | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  seatsPurchased: number | null;
  renewalDate: string | null;
  trialActive: boolean;
  isActive: boolean;
  isPastDue: boolean;
  isCanceled: boolean;
  isTrialing: boolean;
  willCancelAtPeriodEnd: boolean;
}

export interface PortalUsageItem {
  key: string;
  label: string;
  current: number;
  limit: number | null;
  remaining: number | null;
  unlimited: boolean;
  percentageUsed: number | null;
  scope: string;
}

export interface PortalFeatureAvailability {
  key: string;
  label: string;
  included: boolean;
  source: 'features_array' | 'limits_boolean' | 'none';
}

export interface PortalUsageSummary {
  tenantId: string;
  items: PortalUsageItem[];
  features: PortalFeatureAvailability[];
  fetchedAt: string;
}

export interface PortalInvoiceSummary {
  id: string;
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  amountDue: string;
  amountRefunded: string;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  planCode: string | null;
  planName: string | null;
  pdfAvailable: boolean;
}

export interface PortalPaymentSummary {
  id: string;
  provider: string;
  status: string;
  amount: string;
  currency: string;
  planId: string | null;
  planCode: string | null;
  paidAt: string | null;
  failedAt: string | null;
  createdAt: string;
  checkoutUrl: string | null;
  invoiceUrl: string | null;
  hasInvoice: boolean;
}

export interface PortalBillingCustomer {
  tenantId: string;
  billingName: string;
  billingEmail: string;
  billingCountry: string;
  billingCity: string | null;
  billingRegion: string | null;
  preferredCurrency: string;
  taxId: string | null;
  vatNumber: string | null;
  isBusinessCustomer: boolean;
  isTaxExempt: boolean;
}

export interface PortalBillingOverview {
  tenantId: string;
  subscription: PortalSubscriptionState;
  currentPlan: PortalCurrentPlan | null;
  availablePlans: PortalAvailablePlan[];
  usage: PortalUsageSummary;
  latestInvoice: PortalInvoiceSummary | null;
  latestPayment: PortalPaymentSummary | null;
  billingCustomer: PortalBillingCustomer | null;
  availableActions: PortalAvailableAction[];
  fetchedAt: string;
}

export enum PortalAvailableAction {
  UPGRADE = 'UPGRADE',
  DOWNGRADE = 'DOWNGRADE',
  CHANGE_INTERVAL = 'CHANGE_INTERVAL',
  CANCEL_AT_PERIOD_END = 'CANCEL_AT_PERIOD_END',
  RESUME = 'RESUME',
  RENEW = 'RENEW',
  CHECKOUT = 'CHECKOUT',
  VIEW_INVOICES = 'VIEW_INVOICES',
  VIEW_PAYMENTS = 'VIEW_PAYMENTS',
  MANAGE_BILLING_PROFILE = 'MANAGE_BILLING_PROFILE',
}

export interface PortalPlanComparison {
  tenantId: string;
  currentPlanId: string | null;
  plans: PortalAvailablePlan[];
  featuresMatrix: PortalFeatureMatrixRow[];
  limitsMatrix: PortalLimitMatrixRow[];
  fetchedAt: string;
}

export interface PortalFeatureMatrixRow {
  featureKey: string;
  label: string;
  plans: Record<string, boolean>;
}

export interface PortalLimitMatrixRow {
  limitKey: string;
  label: string;
  plans: Record<string, number | null>;
}

export interface PortalCheckoutContext {
  tenantId: string;
  planId: string;
  billingInterval: BillingInterval;
  currency: string;
  provider: string;
  amount: string;
  orderId: string;
  idempotencyKey: string;
}
