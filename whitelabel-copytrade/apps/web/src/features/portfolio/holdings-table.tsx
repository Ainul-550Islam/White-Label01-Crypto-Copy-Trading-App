"use client";

import type { JSX } from 'react';
import { useQuery } from "@tanstack/react-query";
import { portfolioApi } from "@/api/portfolio-api";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { ProfileGate } from "./profile-gate";

function HoldingsTableBody({ profileId }: { profileId: string }): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio", "holdings", profileId],
    queryFn: () => portfolioApi.getHoldings(profileId),
  });
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const holdings = data?.data ?? [];
  return (
    <div className="rounded border bg-card">
      <div className="p-4">
        <h3 className="font-semibold">Holdings</h3>
        <p className="text-xs text-muted">
          Open positions at cost basis, from the accounting ledger
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y bg-gray-50 text-xs text-muted">
            <tr>
              <th className="p-2 text-left">Symbol</th>
              <th className="p-2 text-left">Asset</th>
              <th className="p-2 text-right">Quantity</th>
              <th className="p-2 text-right">Cost basis</th>
              <th className="p-2 text-left">Class</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.id} className="border-b">
                <td className="p-2">{h.symbol}</td>
                <td className="p-2">{h.asset}</td>
                <td className="p-2 text-right">{h.quantity}</td>
                <td className="p-2 text-right">
                  {h.avgCost ? (
                    <Money value={h.avgCost} />
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </td>
                <td className="p-2 text-xs">{h.classification}</td>
              </tr>
            ))}
            {holdings.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-xs text-muted">
                  No holdings
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HoldingsTable(): JSX.Element {
  return (
    <ProfileGate title="Holdings">
      {(profileId) => <HoldingsTableBody profileId={profileId} />}
    </ProfileGate>
  );
}
