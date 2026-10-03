"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { tradingApi, copyEligibility } from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { useTradingStatus } from "./use-trading-status";

export function StrategiesPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["strategies"],
    queryFn: () => tradingApi.listStrategies({ page: 1, limit: 20 }),
  });
  const status = useTradingStatus();
  const strategies = data?.data ?? [];
  return (
    <PageContainer title="Strategies" description="Published strategies you can copy">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : strategies.length === 0 ? (
        <EmptyState title="No strategies yet" description="Published strategies from your traders will appear here." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {strategies.map((s) => {
            const eligibility = copyEligibility(s, status.data);
            return (
              <Link key={s.strategyId} href={`/strategies/${s.strategyId}`} className="rounded border bg-card p-4 hover:shadow">
                <div className="flex justify-between">
                  <h3 className="font-semibold">{s.name}</h3>
                  <StatusBadge status={s.status} />
                </div>
                <p className="text-xs text-muted">
                  {s.type} | {s.followerCount} followers | {s.supportedSymbols.slice(0, 3).join(", ") || "All symbols"}
                </p>
                <p className="mt-1 text-xs">
                  {eligibility.canCopy ? "Can copy" : eligibility.reasons.join(", ") || "Checking eligibility…"}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
