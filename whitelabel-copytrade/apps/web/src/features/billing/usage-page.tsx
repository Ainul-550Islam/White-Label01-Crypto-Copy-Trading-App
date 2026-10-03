"use client";
import { useQuery } from "@tanstack/react-query";
import { billingApi } from "@/api/billing-api";
import { PageContainer } from "@/layout/page-container";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { UsageMeter } from "./usage-meter";

export function UsagePage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["billing", "usage"],
    queryFn: () => billingApi.getUsage(),
  });
  const usage = data ?? [];

  return (
    <PageContainer
      title="Usage"
      description="Backend usage/quota/metering data"
    >
      {isLoading ? (
        <LoadingState message="Loading usage..." />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : usage.length === 0 ? (
        <EmptyState
          title="No usage data"
          description="Usage appears once your plan has metered limits."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {usage.map((u) => (
            <div key={u.meter} className="rounded border bg-card p-4">
              <UsageMeter usage={u} />
              <p className="mt-2 text-xs text-muted">
                {u.unlimited
                  ? "No limit on your plan"
                  : u.remaining === null
                    ? "Remaining: —"
                    : `Remaining: ${u.remaining}`}
                {u.scope ? ` · ${u.scope.toLowerCase()}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
