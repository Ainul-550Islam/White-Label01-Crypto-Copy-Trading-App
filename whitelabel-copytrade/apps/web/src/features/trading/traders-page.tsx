"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { tradingApi } from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

export function TradersPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["traders"],
    queryFn: () => tradingApi.listTraders({ page: 1, limit: 20 }),
  });
  const traders = data?.data ?? [];
  return (
    <PageContainer title="Traders" description="Discover traders you can copy">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : traders.length === 0 ? (
        <EmptyState title="No public traders yet" description="Traders appear here once they publish a public profile." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {traders.map((t) => (
            <Link key={t.traderId} href={`/traders/${t.traderId}`} className="rounded border bg-card p-4 hover:shadow">
              <div className="flex justify-between">
                <h3 className="font-semibold">{t.displayName}</h3>
                <StatusBadge status={t.verificationState} />
              </div>
              <p className="mt-2 text-xs text-muted">
                Trades: {t.totalTrades} | Volume: <Money value={t.totalVolume} />
              </p>
              <p className="text-xs">Followers: {t.followerCount}</p>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
