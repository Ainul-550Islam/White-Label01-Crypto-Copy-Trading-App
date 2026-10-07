"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { tradingApi } from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";

export function TraderDetailPage({ id }: { id: string }): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["trader", id],
    queryFn: () => tradingApi.getTrader(id),
  });
  const strategies = useQuery({
    queryKey: ["trader", id, "strategies"],
    queryFn: () => tradingApi.listTraderStrategies(id, { page: 1, limit: 20 }),
    enabled: Boolean(data),
  });
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <div className="p-4 text-sm">Trader not found</div>;
  return (
    <PageContainer title={data.displayName} description="Trader profile">
      <div className="space-y-4">
        <div className="space-y-4 rounded border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <StatusBadge status={data.verificationState} />
              {data.isFeatured && <StatusBadge status="FEATURED" variant="info" />}
            </div>
            <div className="flex gap-2">
              <Link
                href={`/traders/${data.traderId}/performance`}
                className="rounded border px-3 py-1 text-xs font-medium hover:bg-slate-50"
              >
                Performance Analytics
              </Link>
              <Link
                href={`/traders/compare?ids=${encodeURIComponent(data.traderId)}`}
                className="rounded border px-3 py-1 text-xs font-medium hover:bg-slate-50"
              >
                Compare
              </Link>
            </div>
          </div>
          <p className="text-sm">{data.bio ?? "No bio"}</p>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>Followers: {data.followerCount}</div>
            <div>Trades: {data.totalTrades}</div>
            <div>
              Volume: <Money value={data.totalVolume} />
            </div>
            <div>Venues: {data.supportedVenues.join(", ") || "—"}</div>
          </div>
        </div>
        <div className="rounded border bg-card p-4">
          <h3 className="font-semibold">Strategies</h3>
          {strategies.isLoading ? (
            <LoadingState />
          ) : strategies.error ? (
            <ErrorState error={strategies.error} onRetry={() => void strategies.refetch()} />
          ) : (strategies.data?.data ?? []).length === 0 ? (
            <p className="mt-2 text-xs text-muted">No published strategies.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {(strategies.data?.data ?? []).map((s) => (
                <li key={s.strategyId} className="flex items-center justify-between text-sm">
                  <Link href={`/strategies/${s.strategyId}`} className="underline">
                    {s.name}
                  </Link>
                  <StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
