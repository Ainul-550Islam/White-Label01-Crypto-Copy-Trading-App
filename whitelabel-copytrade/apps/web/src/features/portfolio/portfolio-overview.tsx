"use client";
import { useQuery } from "@tanstack/react-query";
import { portfolioApi } from "@/api/portfolio-api";
import { Money, MoneyWithState } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { ProfileGate } from "./profile-gate";

function PortfolioOverviewBody({
  profileId,
}: {
  profileId: string;
}): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio", "overview", profileId],
    queryFn: () => portfolioApi.getOverview(profileId),
  });
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <div className="text-sm text-muted">No portfolio data</div>;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4 rounded border bg-card p-4">
      <div>
        <p className="text-xs text-muted">NAV</p>
        <MoneyWithState
          value={data.nav}
          currency={data.currency}
          valuationState={data.valuationState}
        />
      </div>
      <div>
        <p className="text-xs text-muted">Cash</p>
        <Money value={data.cash} currency={data.currency} />
      </div>
      <div>
        <p className="text-xs text-muted">Daily PnL</p>
        <Money value={data.dailyPnl} currency={data.currency} showSign />
      </div>
      <div>
        <p className="text-xs text-muted">30-day PnL</p>
        <Money value={data.periodPnl} currency={data.currency} showSign />
      </div>
    </div>
  );
}

export function PortfolioOverview(): JSX.Element {
  return (
    <ProfileGate title="Portfolio">
      {(profileId) => <PortfolioOverviewBody profileId={profileId} />}
    </ProfileGate>
  );
}
