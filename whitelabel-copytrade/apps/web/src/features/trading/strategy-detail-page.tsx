"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { tradingApi, copyEligibility } from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { CopySubscriptionFlow } from "./copy-subscription-flow";
import { useTradingStatus } from "./use-trading-status";

export function StrategyDetailPage({ id }: { id: string }): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["strategy", id],
    queryFn: () => tradingApi.getStrategy(id),
  });
  const status = useTradingStatus();
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <div className="p-4">Strategy not found</div>;
  const eligibility = copyEligibility(data, status.data);
  return (
    <PageContainer title={data.name} description="Strategy details">
      <div className="space-y-4">
        <div className="rounded border bg-card p-4">
          <div className="flex gap-2">
            <StatusBadge status={data.status} />
            <StatusBadge status={data.type} variant="neutral" />
          </div>
          <p className="mt-2 text-sm">{data.description ?? "No description"}</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <dt className="text-muted">Trader</dt>
            <dd>
              <Link href={`/traders/${data.traderId}`} className="underline">
                View trader profile
              </Link>
            </dd>
            <dt className="text-muted">Symbols</dt>
            <dd>{data.supportedSymbols.join(", ") || "All"}</dd>
            <dt className="text-muted">Venues</dt>
            <dd>{data.supportedVenues.join(", ") || "All"}</dd>
            <dt className="text-muted">Followers</dt>
            <dd>{data.followerCount}</dd>
            <dt className="text-muted">Published</dt>
            <dd>{data.publishedAt ? new Date(data.publishedAt).toLocaleDateString() : "Not published"}</dd>
          </dl>
          <p className="mt-3 text-xs">
            Can copy: {eligibility.canCopy ? "Yes" : "No"} {eligibility.reasons.join(", ")}
          </p>
        </div>
        {eligibility.canCopy && <CopySubscriptionFlow strategyId={data.strategyId} traderId={data.traderId} />}
      </div>
    </PageContainer>
  );
}
