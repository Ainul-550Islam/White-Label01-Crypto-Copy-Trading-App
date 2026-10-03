"use client";

import { useQuery } from "@tanstack/react-query";
import { clientLifecycleApi } from "@/api/client-lifecycle-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

/** The caller's accounts (there is no accounts/current route; the list is scoped to the caller). */
export function AccountPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["account", "institutional"],
    queryFn: () => clientLifecycleApi.listAccounts(),
  });
  const accounts = data ?? [];
  return (
    <PageContainer title="Institutional Account" description="Account overview, status, restrictions">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : accounts.length === 0 ? (
        <EmptyState title="No account yet" description="Your account appears here once onboarding opens it." />
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => (
            <div key={a.id} className="space-y-2 rounded border bg-card p-4 text-sm">
              <p>
                <span className="font-medium">{a.displayName}</span>{" "}
                <span className="text-xs text-muted">({a.accountType.toLowerCase()})</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={a.state} />
                {a.complianceStatus && <StatusBadge status={a.complianceStatus} />}
                {a.riskStatus && <StatusBadge status={a.riskStatus} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
