// # Responsibility: discloses the effective lead-trader profit-share policy without inventing fees or realized profit.
"use client";
import type { JSX } from 'react';

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { tradingApi } from "@/api/trading-api";
import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { PageContainer } from "@/layout/page-container";

export function LeaderFeeSettingsPage({ traderId, currency = "USD" }: { traderId: string; currency?: string }): JSX.Element {
  const [selectedCurrency, setSelectedCurrency] = useState(currency);
  const query = useQuery({
    queryKey: ["leader-fee-policy", traderId, selectedCurrency],
    queryFn: () => tradingApi.getLeaderFeePolicy(traderId, selectedCurrency),
    staleTime: 30_000,
  });

  return (
    <PageContainer
      title="Lead trader fee disclosure"
      description="Review the published profit-share rate and its effective period before copying a trader."
    >
      <div className="space-y-4" data-testid="leader-fee-settings-page">
        <nav aria-label="Fee disclosure breadcrumb" className="text-xs text-muted">
          <Link href={`/traders/${encodeURIComponent(traderId)}`} className="underline">Back to trader profile</Link>
        </nav>

        {query.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {!query.isLoading && !query.error && query.data ? (
          <section className="space-y-3 rounded border bg-card p-4" aria-labelledby="leader-fee-policy-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="leader-fee-policy-heading" className="font-semibold">Published fee policy</h2>
                <p className="mt-1 text-xs text-muted">Currency: {query.data.currency}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="leader-fee-currency" className="text-xs text-muted">Fee currency</label>
                <select
                  id="leader-fee-currency"
                  aria-label="Fee currency"
                  value={selectedCurrency}
                  onChange={(event) => setSelectedCurrency(event.target.value)}
                  className="rounded border px-2 py-1 text-xs"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="JPY">JPY</option>
                  <option value="CAD">CAD</option>
                  <option value="AUD">AUD</option>
                  <option value="BTC">BTC</option>
                  <option value="ETH">ETH</option>
                  <option value="USDT">USDT</option>
                  <option value="USDC">USDC</option>
                </select>
                <span className="rounded border px-2 py-1 text-xs" data-testid="leader-fee-policy-status">
                  {query.data.status === "AVAILABLE" ? "Policy available" : "No policy published"}
                </span>
              </div>
            </div>

            {query.data.policy ? (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded border p-3">
                  <dt className="text-xs text-muted">Profit-share rate</dt>
                  <dd className="mt-1 font-semibold" data-testid="leader-fee-rate">
                    {query.data.policy.profitShareBps} bps ({formatBasisPointsPercent(query.data.policy.profitShareBps)})
                  </dd>
                </div>
                <div className="rounded border p-3">
                  <dt className="text-xs text-muted">High-water-mark scope</dt>
                  <dd className="mt-1 font-medium">
                    {query.data.policy.highWaterMarkScope === "PER_FOLLOWER_CURRENCY"
                      ? "Per follower and currency"
                      : "Per trader and currency"}
                  </dd>
                </div>
                <div className="rounded border p-3">
                  <dt className="text-xs text-muted">Policy version</dt>
                  <dd className="mt-1 font-medium">v{query.data.policy.version}</dd>
                </div>
                <div className="rounded border p-3">
                  <dt className="text-xs text-muted">Effective period</dt>
                  <dd className="mt-1 font-medium">
                    <time dateTime={query.data.policy.effectiveFrom}>{query.data.policy.effectiveFrom}</time>
                    {query.data.policy.effectiveTo ? (
                      <> — <time dateTime={query.data.policy.effectiveTo}>{query.data.policy.effectiveTo}</time></>
                    ) : " — ongoing"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted">No active profit-share policy has been published for this trader and currency.</p>
            )}

            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950" data-testid="leader-fee-calculation-unavailable">
              <h3 className="font-semibold">Fee amount unavailable</h3>
              <p className="mt-1">{query.data.feeCalculation.reason}</p>
              <p className="mt-1">This is a rate disclosure only. It is not a charge, statement, or estimate of a customer&apos;s profit.</p>
            </div>
          </section>
        ) : null}
      </div>
    </PageContainer>
  );
}

function formatBasisPointsPercent(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const fractional = String(basisPoints % 100).padStart(2, "0").replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}%` : `${whole}%`;
}
