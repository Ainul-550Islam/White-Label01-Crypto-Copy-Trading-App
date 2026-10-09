"use client";

import type { JSX } from 'react';
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { billingApi } from "@/api/billing-api";
import { ApiError } from "@/api/api-errors";
import { PageContainer } from "@/layout/page-container";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState, InlineError } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

export function CheckoutPage(): JSX.Element {
  const searchParams = useSearchParams();
  const planId = searchParams.get("planId") ?? "";
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  // The plan (and its price) is read from the backend catalogue, never from the URL.
  const plans = useQuery({
    queryKey: ["billing", "plans"],
    queryFn: () => billingApi.listPlans(),
  });
  const plan = plans.data?.find((p) => p.id === planId) ?? null;

  const handleCheckout = async (): Promise<void> => {
    if (!plan) return;
    setLoading(true);
    setError("");
    try {
      const checkout = await billingApi.createCheckout({
        planId: plan.id,
        successUrl: `${window.location.origin}/billing`,
        cancelUrl: `${window.location.origin}/billing/plans`,
      });
      if (!checkout.redirectUrl) {
        setError(
          "The payment provider did not return a checkout page. Please try again later.",
        );
        return;
      }
      window.location.assign(checkout.redirectUrl);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.getUserMessage()
          : "Checkout could not be started. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer
      title="Checkout"
      description="Real backend checkout flow, no hardcoded prices"
    >
      {plans.isLoading ? (
        <LoadingState message="Loading plan..." />
      ) : plans.error ? (
        <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
      ) : !plan ? (
        <EmptyState
          title="Plan not found"
          description="Choose a plan from the catalogue to continue."
          action={{ label: "View Plans", href: "/billing/plans" }}
        />
      ) : plan.isCurrent ? (
        <EmptyState
          title="Already subscribed"
          description={`${plan.name} is your current plan.`}
          action={{
            label: "Manage subscription",
            href: "/billing/subscription",
          }}
        />
      ) : (
        <div className="max-w-md rounded border bg-card p-4">
          <h3 className="font-semibold">{plan.name}</h3>
          <p className="mt-1 text-sm">
            <Money value={plan.price} currency={plan.currency} /> /{" "}
            {plan.billingInterval.toLowerCase()}
          </p>
          {plan.trialDays > 0 && (
            <p className="text-xs text-muted">
              Includes a {plan.trialDays}-day trial.
            </p>
          )}
          <p className="mt-2 text-xs text-muted">
            You will be redirected to the secure payment page. The amount
            charged, including any tax, is calculated by the billing system.
          </p>
          {error && (
            <div className="mt-2">
              <InlineError message={error} />
            </div>
          )}
          <button
            type="button"
            onClick={() => void handleCheckout()}
            disabled={loading}
            className="mt-4 w-full rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {loading ? "Redirecting..." : "Proceed to Checkout"}
          </button>
          <Link
            href="/billing/plans"
            className="mt-2 block text-center text-xs text-muted"
          >
            Back to plans
          </Link>
        </div>
      )}
    </PageContainer>
  );
}
