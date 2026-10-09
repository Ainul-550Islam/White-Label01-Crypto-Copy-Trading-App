"use client";

import type { JSX } from 'react';
import { useQuery } from "@tanstack/react-query";
import { reportingApi } from "@/api/reporting-api";
import { ApiError } from "@/api/api-errors";
import { PageContainer } from "@/layout/page-container";
import { Money } from "@/components/money";
import { Percentage } from "@/components/percentage";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { ReportDownload } from "./report-download";

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function StatementDetailPage({ id }: { id: string }): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["statement", id],
    queryFn: () => reportingApi.getStatement(id),
    retry: (count, err) =>
      !(
        err instanceof ApiError &&
        (err.status === 400 || err.status === 403 || err.status === 404)
      ) && count < 2,
  });

  if (isLoading) return <LoadingState message="Loading statement..." />;

  // The API answers 404 (or 400 for an unknown id) when the statement is missing or
  // belongs to a profile the caller cannot see: never show another customer's data.
  const notVisible =
    error instanceof ApiError && (error.status === 400 || error.status === 404);
  if (notVisible || (!error && !data)) {
    return (
      <PageContainer
        title="Statement"
        description="Persisted account statement"
      >
        <EmptyState
          title="Statement not found"
          description="Statement not found or not owned by current tenant"
        />
      </PageContainer>
    );
  }
  if (error || !data) {
    return (
      <PageContainer
        title="Statement"
        description="Persisted account statement"
      >
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const currency = data.currency;
  return (
    <PageContainer
      title={`Statement ${data.id.slice(0, 8)}`}
      description="Full persisted statement detail"
    >
      <div className="space-y-4">
        <div className="rounded border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {new Date(data.periodStart).toLocaleDateString()} –{" "}
              {new Date(data.periodEnd).toLocaleDateString()}
            </p>
            <StatusBadge status={data.state} />
          </div>
          <div className="mt-2 divide-y">
            <Row label="Opening NAV">
              <Money value={data.openingNav} currency={currency} />
            </Row>
            <Row label="Closing NAV">
              <Money value={data.closingNav} currency={currency} />
            </Row>
            <Row label="Cash">
              <Money value={data.cash} currency={currency} />
            </Row>
            <Row
              label={`Return${data.returnMethodology ? ` (${data.returnMethodology})` : ""}`}
            >
              <Percentage value={data.returnPercent} />
            </Row>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded border bg-card p-4">
            <h4 className="font-medium">Profit and loss</h4>
            <div className="mt-2 divide-y">
              <Row label="Realized">
                <Money value={data.realizedPnl} currency={currency} showSign />
              </Row>
              <Row label="Unrealized">
                <Money
                  value={data.unrealizedPnl}
                  currency={currency}
                  showSign
                />
              </Row>
              <Row label="Gross">
                <Money value={data.grossPnl} currency={currency} showSign />
              </Row>
              <Row label="Fees">
                <Money value={data.feesTotal} currency={currency} />
              </Row>
              <Row label="Net">
                <Money value={data.netPnl} currency={currency} showSign />
              </Row>
            </div>
          </div>
          <div className="rounded border bg-card p-4">
            <h4 className="font-medium">Cash flows</h4>
            <div className="mt-2 divide-y">
              <Row label="Deposits">
                <Money value={data.deposits} currency={currency} />
              </Row>
              <Row label="Withdrawals">
                <Money value={data.withdrawals} currency={currency} />
              </Row>
              <Row label="Net transfers">
                <Money value={data.transfers} currency={currency} showSign />
              </Row>
              <Row label="Trades">{data.tradeCount ?? "—"}</Row>
            </div>
          </div>
        </div>

        <div className="rounded border bg-card p-4">
          <h4 className="font-medium">Ending holdings</h4>
          {data.endingHoldings.length === 0 ? (
            <p className="mt-2 text-xs text-muted">
              No open holdings at the end of the period.
            </p>
          ) : (
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1">Symbol</th>
                  <th className="py-1 text-right">Quantity</th>
                  <th className="py-1 text-right">Cost basis</th>
                </tr>
              </thead>
              <tbody>
                {data.endingHoldings.map((holding, index) => (
                  <tr key={`${holding.symbol}-${index}`} className="border-t">
                    <td className="py-1">{holding.symbol}</td>
                    <td className="py-1 text-right font-mono">
                      {holding.quantity}
                    </td>
                    <td className="py-1 text-right">
                      {holding.costBasis ? (
                        <Money value={holding.costBasis} currency={currency} />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <ReportDownload statementId={data.id} />
      </div>
    </PageContainer>
  );
}
