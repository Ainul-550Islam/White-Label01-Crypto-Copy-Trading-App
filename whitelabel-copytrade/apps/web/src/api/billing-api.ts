import { apiClient } from "./api-client";
import { newIdempotencyKey } from "@/lib/idempotency-key";

/**
 * Tenant SaaS billing through the customer billing portal (/v1/billing/portal).
 *
 * Every call needs `subscription:read` (mutations `subscription:manage`), which
 * tenant administrators and finance hold; other roles get 403. Prices, limits,
 * usage percentages and the allowed lifecycle actions are all decided by the
 * backend; this client only maps the responses into view models.
 */

export type BillingAction =
  | "UPGRADE"
  | "DOWNGRADE"
  | "CHANGE_INTERVAL"
  | "CANCEL_AT_PERIOD_END"
  | "RESUME"
  | "RENEW"
  | "CHECKOUT"
  | "VIEW_INVOICES"
  | "VIEW_PAYMENTS"
  | "MANAGE_BILLING_PROFILE";

export interface Plan {
  id: string;
  code: string;
  /** Alias of `code`, kept for existing callers. */
  slug: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  billingInterval: string;
  trialDays: number;
  features: string[];
  limits: Record<string, number | boolean | null>;
  isCurrent: boolean;
  upgradeEligible: boolean;
  downgradeEligible: boolean;
}

export interface Subscription {
  id: string;
  planId: string | null;
  planCode: string | null;
  planName: string | null;
  status: string;
  interval: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  renewalDate: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  isActive: boolean;
  isPastDue: boolean;
  isTrialing: boolean;
}

export interface UsageRecord {
  meter: string;
  label: string;
  current: number;
  limit: number | null;
  remaining: number | null;
  unlimited: boolean;
  percentageUsed: number | null;
  scope: string;
}

export interface FeatureAvailability {
  key: string;
  label: string;
  included: boolean;
}

export interface Invoice {
  id: string;
  number: string;
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
  periodStart: string | null;
  periodEnd: string | null;
  planName: string | null;
  pdfAvailable: boolean;
}

export interface Payment {
  id: string;
  provider: string;
  status: string;
  amount: string;
  currency: string;
  planCode: string | null;
  paidAt: string | null;
  failedAt: string | null;
  createdAt: string;
  invoiceUrl: string | null;
  hasInvoice: boolean;
}

export interface BillingOverview {
  subscription: Subscription | null;
  currentPlan: Plan | null;
  availablePlans: Plan[];
  usage: UsageRecord[];
  features: FeatureAvailability[];
  latestInvoice: Invoice | null;
  latestPayment: Payment | null;
  availableActions: BillingAction[];
}

export interface Checkout {
  checkoutId: string;
  paymentId: string;
  provider: string;
  status: string;
  paymentStatus: string;
  /** Hosted page to send the user to (checkout session or provider invoice). */
  redirectUrl: string | null;
  checkoutUrl: string | null;
  amount: string;
  currency: string;
  planName: string;
  billingInterval: string;
  expiresAt: string | null;
}

export interface SubscriptionActionResult {
  action: string;
  subscriptionId: string;
  status: string;
  effectiveAt: string | null;
  message: string | null;
}

type Raw = Record<string, unknown>;

function str(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

function optStr(value: unknown): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : String(value);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toPlan(raw: Raw): Plan {
  const limits: Record<string, number | boolean | null> = {};
  if (raw.limits && typeof raw.limits === "object") {
    for (const [key, value] of Object.entries(raw.limits as Raw)) {
      limits[key] = typeof value === "boolean" ? value : num(value);
    }
  }
  const code = str(raw.code);
  return {
    id: str(raw.id),
    code,
    slug: code,
    name: str(raw.name, code),
    description: optStr(raw.description),
    price: str(raw.price, "0"),
    currency: str(raw.currency, "USD"),
    billingInterval: str(raw.interval ?? raw.billingInterval),
    trialDays: num(raw.trialDays) ?? 0,
    features: Array.isArray(raw.features)
      ? raw.features.map((f) => String(f))
      : [],
    limits,
    isCurrent: raw.isCurrent === true,
    upgradeEligible: raw.upgradeEligible === true,
    downgradeEligible: raw.downgradeEligible === true,
  };
}

/** Maps the portal subscription state; `null` when the tenant has no subscription. */
export function toSubscription(
  raw: Raw | null | undefined,
): Subscription | null {
  if (!raw || !raw.id) return null;
  return {
    id: str(raw.id),
    planId: optStr(raw.planId),
    planCode: optStr(raw.planCode),
    planName: optStr(raw.planName),
    status: str(raw.status, "UNKNOWN"),
    interval: optStr(raw.interval),
    currentPeriodStart: optStr(raw.currentPeriodStart),
    currentPeriodEnd: optStr(raw.currentPeriodEnd),
    renewalDate: optStr(raw.renewalDate),
    trialEnd: optStr(raw.trialEndsAt),
    cancelAtPeriodEnd:
      raw.cancelAtPeriodEnd === true || raw.willCancelAtPeriodEnd === true,
    canceledAt: optStr(raw.canceledAt),
    isActive: raw.isActive === true,
    isPastDue: raw.isPastDue === true,
    isTrialing: raw.isTrialing === true,
  };
}

export function toUsageRecord(raw: Raw): UsageRecord {
  const key = str(raw.key);
  return {
    meter: key,
    label: str(raw.label, key),
    current: num(raw.current) ?? 0,
    limit: num(raw.limit),
    remaining: num(raw.remaining),
    unlimited: raw.unlimited === true,
    percentageUsed: num(raw.percentageUsed),
    scope: str(raw.scope),
  };
}

export function toInvoice(raw: Raw): Invoice {
  return {
    id: str(raw.id),
    number: str(raw.invoiceNumber ?? raw.number),
    status: str(raw.status, "UNKNOWN"),
    issueDate: str(raw.issueDate ?? raw.createdAt),
    dueDate: optStr(raw.dueDate),
    currency: str(raw.currency, "USD"),
    subtotal: str(raw.subtotal, "0"),
    discountTotal: str(raw.discountTotal, "0"),
    taxTotal: str(raw.taxTotal, "0"),
    total: str(raw.total, "0"),
    amountPaid: str(raw.amountPaid, "0"),
    amountDue: str(raw.amountDue, "0"),
    amountRefunded: str(raw.amountRefunded, "0"),
    periodStart: optStr(raw.billingPeriodStart),
    periodEnd: optStr(raw.billingPeriodEnd),
    planName: optStr(raw.planName),
    pdfAvailable: raw.pdfAvailable === true,
  };
}

export function toPayment(raw: Raw): Payment {
  return {
    id: str(raw.id),
    provider: str(raw.provider),
    status: str(raw.status, "UNKNOWN"),
    amount: str(raw.amount, "0"),
    currency: str(raw.currency, "USD"),
    planCode: optStr(raw.planCode),
    paidAt: optStr(raw.paidAt),
    failedAt: optStr(raw.failedAt),
    createdAt: str(raw.createdAt),
    invoiceUrl: optStr(raw.invoiceUrl),
    hasInvoice: raw.hasInvoice === true,
  };
}

function rows(value: unknown): Raw[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Raw => typeof item === "object" && item !== null,
      )
    : [];
}

export function toBillingOverview(raw: Raw): BillingOverview {
  const usage = (raw.usage ?? {}) as Raw;
  return {
    subscription: toSubscription(raw.subscription as Raw | null),
    currentPlan: raw.currentPlan
      ? { ...toPlan(raw.currentPlan as Raw), isCurrent: true }
      : null,
    availablePlans: rows(raw.availablePlans).map(toPlan),
    usage: rows(usage.items).map(toUsageRecord),
    features: rows(usage.features).map((f) => ({
      key: str(f.key),
      label: str(f.label, str(f.key)),
      included: f.included === true,
    })),
    latestInvoice: raw.latestInvoice
      ? toInvoice(raw.latestInvoice as Raw)
      : null,
    latestPayment: raw.latestPayment
      ? toPayment(raw.latestPayment as Raw)
      : null,
    availableActions: Array.isArray(raw.availableActions)
      ? (raw.availableActions.map((a) => String(a)) as BillingAction[])
      : [],
  };
}

export function toCheckout(raw: Raw): Checkout {
  const checkoutUrl = optStr(raw.checkoutUrl);
  return {
    checkoutId: str(raw.checkoutId),
    paymentId: str(raw.paymentId),
    provider: str(raw.provider),
    status: str(raw.status),
    paymentStatus: str(raw.paymentStatus),
    redirectUrl: checkoutUrl ?? optStr(raw.invoiceUrl),
    checkoutUrl,
    amount: str(raw.amount, "0"),
    currency: str(raw.currency, "USD"),
    planName: str(raw.planName),
    billingInterval: str(raw.billingInterval),
    expiresAt: optStr(raw.expiresAt),
  };
}

function toActionResult(raw: Raw): SubscriptionActionResult {
  return {
    action: str(raw.action),
    subscriptionId: str(raw.subscriptionId),
    status: str(raw.status),
    effectiveAt: optStr(raw.effectiveAt),
    message: optStr(raw.message),
  };
}

export const billingApi = {
  getOverview: async (): Promise<BillingOverview> =>
    toBillingOverview(await apiClient.get<Raw>("/v1/billing/portal/overview")),

  /** Plans offered to this tenant, flagged with the current plan and eligible changes. */
  listPlans: async (): Promise<Plan[]> => {
    const comparison = await apiClient.get<{ plans?: Raw[] }>(
      "/v1/billing/portal/plans/comparison",
    );
    return rows(comparison.plans).map(toPlan);
  },

  getCurrentSubscription: async (): Promise<Subscription | null> => {
    const overview = await apiClient.get<Raw>("/v1/billing/portal/overview");
    return toSubscription(overview.subscription as Raw | null);
  },

  createCheckout: async (data: {
    planId: string;
    billingInterval?: string;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<Checkout> =>
    toCheckout(
      await apiClient.post<Raw>("/v1/billing/portal/checkout", {
        planId: data.planId,
        ...(data.billingInterval
          ? { billingInterval: data.billingInterval }
          : {}),
        ...(data.successUrl ? { successUrl: data.successUrl } : {}),
        ...(data.cancelUrl ? { cancelUrl: data.cancelUrl } : {}),
        idempotencyKey: newIdempotencyKey("checkout"),
      }),
    ),

  getCheckoutStatus: (checkoutId: string) =>
    apiClient.get<{
      checkoutId: string;
      status: string;
      paymentStatus: string;
      verified: boolean;
    }>(`/v1/billing/portal/checkout/${encodeURIComponent(checkoutId)}/status`),

  /** Schedules cancellation at the end of the current period (access continues until then). */
  cancelSubscription: async (
    data: { reason?: string } = {},
  ): Promise<SubscriptionActionResult> =>
    toActionResult(
      await apiClient.post<Raw>(
        "/v1/billing/portal/subscription/cancel",
        data.reason ? { reason: data.reason } : {},
      ),
    ),

  resumeSubscription: async (): Promise<SubscriptionActionResult> =>
    toActionResult(
      await apiClient.post<Raw>("/v1/billing/portal/subscription/resume", {}),
    ),

  changePlan: async (data: {
    planId: string;
    atPeriodEnd?: boolean;
  }): Promise<SubscriptionActionResult> =>
    toActionResult(
      await apiClient.post<Raw>("/v1/billing/portal/subscription/change-plan", {
        planId: data.planId,
        ...(data.atPeriodEnd !== undefined
          ? { atPeriodEnd: data.atPeriodEnd }
          : {}),
      }),
    ),

  listInvoices: async (params?: {
    status?: string;
    limit?: number;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ data: Invoice[]; total: number }> => {
    const res = await apiClient.get<{ invoices?: Raw[]; total?: number }>(
      "/v1/billing/portal/invoices",
      {
        searchParams: {
          status: params?.status,
          limit: params?.limit,
          fromDate: params?.fromDate,
          toDate: params?.toDate,
        },
      },
    );
    const data = rows(res.invoices).map(toInvoice);
    return { data, total: res.total ?? data.length };
  },

  getInvoice: async (id: string): Promise<Invoice> =>
    toInvoice(
      await apiClient.get<Raw>(
        `/v1/billing/portal/invoices/${encodeURIComponent(id)}`,
      ),
    ),

  listPayments: async (params?: {
    status?: string;
    limit?: number;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ data: Payment[]; total: number }> => {
    const res = await apiClient.get<{ payments?: Raw[]; total?: number }>(
      "/v1/billing/portal/payments",
      {
        searchParams: {
          status: params?.status,
          limit: params?.limit,
          fromDate: params?.fromDate,
          toDate: params?.toDate,
        },
      },
    );
    const data = rows(res.payments).map(toPayment);
    return { data, total: res.total ?? data.length };
  },

  getUsage: async (): Promise<UsageRecord[]> => {
    const summary = await apiClient.get<{ items?: Raw[] }>(
      "/v1/billing/portal/usage",
    );
    return rows(summary.items).map(toUsageRecord);
  },
};
