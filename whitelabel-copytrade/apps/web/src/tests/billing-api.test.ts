/**
 * Mapping of billing-portal responses (/v1/billing/portal/*) into the billing views.
 */
import {
  toBillingOverview,
  toCheckout,
  toInvoice,
  toPlan,
  toSubscription,
  toUsageRecord,
} from "../api/billing-api";

describe("billing-api mappers", () => {
  test("plan uses interval/code from the catalogue and keeps eligibility flags", () => {
    const plan = toPlan({
      id: "plan-pro",
      code: "PRO",
      name: "Pro",
      description: null,
      price: "99.00",
      currency: "USD",
      interval: "MONTHLY",
      trialDays: 14,
      limits: { maxUsers: 50, maxTraders: null, customDomain: true },
      features: ["copy_trading", "api_access"],
      isCurrent: false,
      upgradeEligible: true,
      downgradeEligible: false,
    });
    expect(plan).toMatchObject({
      id: "plan-pro",
      code: "PRO",
      slug: "PRO",
      billingInterval: "MONTHLY",
      trialDays: 14,
      upgradeEligible: true,
      isCurrent: false,
    });
    expect(plan.limits).toEqual({
      maxUsers: 50,
      maxTraders: null,
      customDomain: true,
    });
  });

  test("no subscription maps to null, not an empty object", () => {
    expect(toSubscription(null)).toBeNull();
    expect(toSubscription({ id: null, cancelAtPeriodEnd: false })).toBeNull();
  });

  test("subscription state keeps backend lifecycle flags", () => {
    const sub = toSubscription({
      id: "sub-1",
      planId: "plan-pro",
      planCode: "PRO",
      planName: "Pro",
      status: "ACTIVE",
      interval: "MONTHLY",
      currentPeriodStart: "2026-09-01T00:00:00.000Z",
      currentPeriodEnd: "2026-10-01T00:00:00.000Z",
      renewalDate: "2026-10-01T00:00:00.000Z",
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      willCancelAtPeriodEnd: true,
      isActive: true,
      isPastDue: false,
      isTrialing: false,
    });
    expect(sub).toMatchObject({
      id: "sub-1",
      planName: "Pro",
      status: "ACTIVE",
      cancelAtPeriodEnd: true,
      isActive: true,
      trialEnd: null,
    });
  });

  test("usage is taken verbatim: unlimited meters have no limit or percentage", () => {
    expect(
      toUsageRecord({
        key: "users",
        label: "Users",
        current: 12,
        limit: 50,
        remaining: 38,
        unlimited: false,
        percentageUsed: 24,
        scope: "TENANT",
      }),
    ).toEqual({
      meter: "users",
      label: "Users",
      current: 12,
      limit: 50,
      remaining: 38,
      unlimited: false,
      percentageUsed: 24,
      scope: "TENANT",
    });
    expect(
      toUsageRecord({
        key: "traders",
        label: "Traders",
        current: 3,
        limit: null,
        remaining: null,
        unlimited: true,
        percentageUsed: null,
        scope: "TENANT",
      }),
    ).toMatchObject({
      limit: null,
      remaining: null,
      percentageUsed: null,
      unlimited: true,
    });
  });

  test("invoice maps invoiceNumber, totals and billing period", () => {
    const inv = toInvoice({
      id: "inv-1",
      invoiceNumber: "INV-2026-0001",
      status: "PAID",
      issueDate: "2026-09-01T00:00:00.000Z",
      dueDate: null,
      currency: "EUR",
      subtotal: "100.00",
      discountTotal: "0.00",
      taxTotal: "21.00",
      total: "121.00",
      amountPaid: "121.00",
      amountDue: "0.00",
      amountRefunded: "0.00",
      billingPeriodStart: "2026-09-01T00:00:00.000Z",
      billingPeriodEnd: "2026-09-30T23:59:59.000Z",
      planCode: "PRO",
      planName: "Pro",
      pdfAvailable: true,
    });
    expect(inv).toMatchObject({
      number: "INV-2026-0001",
      taxTotal: "21.00",
      total: "121.00",
      amountDue: "0.00",
      periodStart: "2026-09-01T00:00:00.000Z",
      pdfAvailable: true,
    });
  });

  test("overview wires subscription, usage, features and allowed actions", () => {
    const overview = toBillingOverview({
      subscription: { id: "sub-1", status: "ACTIVE", cancelAtPeriodEnd: false },
      currentPlan: {
        id: "plan-pro",
        code: "PRO",
        name: "Pro",
        price: "99",
        currency: "USD",
        interval: "MONTHLY",
      },
      availablePlans: [
        { id: "plan-pro", code: "PRO", name: "Pro", isCurrent: true },
      ],
      usage: {
        items: [{ key: "users", label: "Users", current: 1, limit: 5 }],
        features: [{ key: "api", label: "API", included: true }],
      },
      latestInvoice: null,
      latestPayment: null,
      availableActions: ["CANCEL_AT_PERIOD_END", "VIEW_INVOICES"],
    });
    expect(overview.subscription?.id).toBe("sub-1");
    expect(overview.currentPlan?.isCurrent).toBe(true);
    expect(overview.usage).toHaveLength(1);
    expect(overview.features).toEqual([
      { key: "api", label: "API", included: true },
    ]);
    expect(overview.availableActions).toEqual([
      "CANCEL_AT_PERIOD_END",
      "VIEW_INVOICES",
    ]);
    expect(overview.latestInvoice).toBeNull();
  });

  test("checkout redirects to the checkout session, else the provider invoice page", () => {
    expect(
      toCheckout({
        checkoutId: "c1",
        checkoutUrl: "https://pay.example/session",
        invoiceUrl: "https://pay.example/inv",
      }).redirectUrl,
    ).toBe("https://pay.example/session");
    expect(
      toCheckout({
        checkoutId: "c2",
        checkoutUrl: "",
        invoiceUrl: "https://nowpayments.example/inv",
      }).redirectUrl,
    ).toBe("https://nowpayments.example/inv");
    expect(toCheckout({ checkoutId: "c3" }).redirectUrl).toBeNull();
  });
});
