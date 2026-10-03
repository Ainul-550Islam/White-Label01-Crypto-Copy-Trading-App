"use client";
import { useQuery } from "@tanstack/react-query";
import { fundingApi } from "@/api/funding-api";
import { Money } from "@/components/money";
import { FundingStatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";

export function TransactionHistory(): JSX.Element {
  // Only the caller's own requests are returned (tenant isolation and account ownership are enforced server-side).
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["funding", "history"],
    queryFn: () => fundingApi.listHistory({ limit: 50 }),
  });

  if (isLoading) return <LoadingState message="Loading history..." />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const items = data?.data ?? [];
  return (
    <div className="rounded border bg-card">
      <div className="p-4">
        <h3 className="font-semibold">Transaction History</h3>
        <p className="text-xs text-muted">
          Persisted funding/withdrawal history from backend
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y bg-gray-50 text-xs text-muted">
            <tr>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-right">Requested</th>
              <th className="p-2 text-right">Confirmed</th>
              <th className="p-2">State</th>
              <th className="p-2 text-left">Requested at</th>
            </tr>
          </thead>
          <tbody>
            {items.map((f) => (
              <tr key={`${f.type}-${f.id}`} className="border-b">
                <td className="p-2">
                  {f.type === "DEPOSIT" ? "Deposit" : "Withdrawal"}
                </td>
                <td className="p-2 text-right">
                  <Money value={f.amount} currency={f.currency} />
                </td>
                <td className="p-2 text-right">
                  {f.confirmedAmount ? (
                    <Money value={f.confirmedAmount} currency={f.currency} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="p-2 text-center">
                  <FundingStatusBadge state={f.state} />
                  {f.failureReason && (
                    <p className="mt-1 text-xs text-red-600">
                      {f.failureReason}
                    </p>
                  )}
                </td>
                <td className="p-2 text-xs">
                  {f.requestedAt
                    ? new Date(f.requestedAt).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-xs text-muted">
                  No transactions
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
