"use client";

import type { JSX } from 'react';
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { billingApi } from "@/api/billing-api";
import { PageContainer } from "@/layout/page-container";
import { Money } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { UsageMeter } from "./usage-meter";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export function BillingPage(): JSX.Element {
  // One backend call: subscription state, plan, usage, latest invoice/payment and allowed actions.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["billing", "overview"],
    queryFn: () => billingApi.getOverview(),
  });

  return (
    <PageContainer
      title="Billing"
      description="Customer billing dashboard from backend"
      actions={
        <div className="flex gap-2">
          <Link
            href="/billing/plans"
            className="rounded border px-4 py-2 text-sm"
          >
            View Plans
          </Link>
          <Link
            href="/billing/invoices"
            className="rounded border px-4 py-2 text-sm"
          >
            Invoices
          </Link>
          <Link
            href="/billing/usage"
            className="rounded border px-4 py-2 text-sm"
          >
            Usage
          </Link>
        </div>
      }
    >
      {isLoading ? (
        <LoadingState message="Loading billing..." />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Subscription</h3>
              <Link
                href="/billing/subscription"
                className="text-xs text-primary"
              >
                Manage
              </Link>
            </div>
            {data.subscription ? (
              <div className="mt-2 space-y-1 text-sm">
                <p>
                  {data.subscription.planName ??
                    data.subscription.planCode ??
                    "Current plan"}{" "}
                  <StatusBadge status={data.subscription.status} />
                </p>
                {data.currentPlan && (
                  <p className="text-xs text-muted">
                    <Money
                      value={data.currentPlan.price}
                      currency={data.currentPlan.currency}
                    />{" "}
                    / {data.currentPlan.billingInterval.toLowerCase()}
                  </p>
                )}
                <p className="text-xs text-muted">
                  {data.subscription.cancelAtPeriodEnd ? "Ends" : "Renews"}{" "}
                  {formatDate(
                    data.subscription.renewalDate ??
                      data.subscription.currentPeriodEnd,
                  )}
                </p>
                {data.subscription.isTrialing && (
                  <p className="text-xs text-muted">
                    Trial ends {formatDate(data.subscription.trialEnd)}
                  </p>
                )}
                {data.subscription.isPastDue && (
                  <p className="text-xs text-red-600">
                    Payment is past due. Please settle the open invoice.
                  </p>
                )}
              </div>
            ) : (
              <EmptyState
                title="No subscription"
                description="Choose a plan to get started"
                action={{ label: "View Plans", href: "/billing/plans" }}
              />
            )}
          </div>

          <div className="rounded border bg-card p-4">
            <h3 className="font-semibold">Usage</h3>
            {data.usage.length === 0 ? (
              <p className="mt-2 text-xs text-muted">
                No metered usage for this period.
              </p>
            ) : (
              <div className="mt-2 space-y-3">
                {data.usage.slice(0, 4).map((u) => (
                  <UsageMeter key={u.meter} usage={u} />
                ))}
              </div>
            )}
          </div>

          <div className="rounded border bg-card p-4">
            <h3 className="font-semibold">Latest invoice</h3>
            {data.latestInvoice ? (
              <div className="mt-2 flex items-center justify-between text-sm">
                <div>
                  <p>{data.latestInvoice.number}</p>
                  <p className="text-xs text-muted">
                    Issued {formatDate(data.latestInvoice.issueDate)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Money
                    value={data.latestInvoice.total}
                    currency={data.latestInvoice.currency}
                  />
                  <StatusBadge status={data.latestInvoice.status} />
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted">No invoices yet.</p>
            )}
          </div>

          <div className="rounded border bg-card p-4">
            <h3 className="font-semibold">Latest payment</h3>
            {data.latestPayment ? (
              <div className="mt-2 flex items-center justify-between text-sm">
                <div>
                  <p>{data.latestPayment.provider}</p>
                  <p className="text-xs text-muted">
                    {formatDate(
                      data.latestPayment.paidAt ?? data.latestPayment.createdAt,
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Money
                    value={data.latestPayment.amount}
                    currency={data.latestPayment.currency}
                  />
                  <StatusBadge status={data.latestPayment.status} />
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted">No payments yet.</p>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
