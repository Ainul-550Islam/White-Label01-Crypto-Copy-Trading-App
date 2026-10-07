"use client";

// # Responsibility: renders a trader-profile owner's own non-sandbox exposure with explicit source scope, freshness, and unavailable valuations.

import { useQuery } from "@tanstack/react-query";
import { customerExposureApi, type TraderExposureView } from "@/api/customer-exposure-api";
import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";

function exposureStateLabel(state: TraderExposureView["state"]): string {
  switch (state) {
    case "CURRENT":
      return "Current reference data";
    case "STALE":
      return "Stale reference data";
    case "UNKNOWN":
      return "Valuation unavailable";
    case "EMPTY":
      return "No open exposure";
  }
}

function exposureStateClass(state: TraderExposureView["state"]): string {
  if (state === "CURRENT") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (state === "STALE") return "border-amber-300 bg-amber-50 text-amber-900";
  if (state === "UNKNOWN") return "border-rose-300 bg-rose-50 text-rose-900";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function timestampLabel(value: string | null): string {
  if (value === null || !Number.isFinite(Date.parse(value))) return "Unavailable";
  return new Date(value).toISOString();
}

function exactAmount(value: string | null, asset: string | null): string {
  if (value === null || asset === null || asset.trim().length === 0) return "Unavailable";
  return `${value} ${asset}`;
}

function lineStateLabel(line: TraderExposureView["lines"][number]): string {
  if (line.state === "CURRENT") return "Current";
  if (line.state === "STALE") return "Stale";
  return "Unavailable";
}

function ExposureTable({ data }: { data: TraderExposureView }): JSX.Element {
  return (
    <div className="overflow-x-auto rounded border" data-testid="trader-exposure-lines">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-600">
          <tr>
            <th className="p-3">Instrument</th>
            <th className="p-3 text-right">Net quantity</th>
            <th className="p-3 text-right">Gross position notional</th>
            <th className="p-3 text-right">Open-order commitment</th>
            <th className="p-3">Valuation</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line) => (
            <tr key={`${line.venue}:${line.symbol}:${line.marketType ?? "unknown"}`} className="border-b last:border-0">
              <td className="p-3">
                <span className="font-medium">{line.symbol}</span>
                <span className="ml-2 text-xs text-slate-600">{line.venue}</span>
                <div className="text-xs text-slate-500">{line.marketType ?? "Market type unavailable"}</div>
              </td>
              <td className="p-3 text-right font-mono">{line.netQuantity ?? "Unavailable"}</td>
              <td className="p-3 text-right font-mono">
                {exactAmount(line.grossPositionNotional, line.quoteAsset)}
              </td>
              <td className="p-3 text-right font-mono">
                {exactAmount(line.openOrderCommitment, line.quoteAsset)}
                {line.openOrderCount > 0 ? (
                  <div className="text-xs font-sans text-slate-500">
                    {line.openOrderCount} working order{line.openOrderCount === 1 ? "" : "s"}
                  </div>
                ) : null}
              </td>
              <td className="p-3">
                <span className={`rounded-full border px-2 py-1 text-xs ${exposureStateClass(line.state)}`}>
                  {lineStateLabel(line)}
                </span>
                {line.price !== null ? (
                  <div className="mt-1 text-xs text-slate-600">Reference price: {exactAmount(line.price, line.quoteAsset)} · 1-minute close</div>
                ) : (
                  <div className="mt-1 text-xs text-slate-600">Reference price unavailable</div>
                )}
                {line.priceTimestamp ? (
                  <div className="mt-1 text-xs text-slate-500">Price as of {timestampLabel(line.priceTimestamp)}</div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuoteTotals({ data }: { data: TraderExposureView }): JSX.Element {
  if (data.totalsByQuoteAsset.length === 0) {
    return <p className="mt-3 text-sm text-slate-600">No quote-asset totals are available.</p>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="border-b text-left text-xs uppercase text-slate-600">
          <tr>
            <th className="py-2">Quote asset</th>
            <th className="py-2 text-right">Gross positions</th>
            <th className="py-2 text-right">Working orders</th>
            <th className="py-2 text-right">Total reference value</th>
            <th className="py-2">State</th>
          </tr>
        </thead>
        <tbody>
          {data.totalsByQuoteAsset.map((total) => (
            <tr key={total.quoteAsset} className="border-b last:border-0">
              <td className="py-3 font-medium">{total.quoteAsset}</td>
              <td className="py-3 text-right font-mono">{exactAmount(total.grossPositionNotional, total.quoteAsset)}</td>
              <td className="py-3 text-right font-mono">{exactAmount(total.openOrderCommitment, total.quoteAsset)}</td>
              <td className="py-3 text-right font-mono">{exactAmount(total.totalNotional, total.quoteAsset)}</td>
              <td className="py-3">
                <span className={`rounded-full border px-2 py-1 text-xs ${exposureStateClass(total.state)}`}>
                  {exposureStateLabel(total.state)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TraderExposurePanel({ traderId }: { traderId: string }): JSX.Element {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["trader", traderId, "exposure"],
    queryFn: () => customerExposureApi.getTraderExposure(traderId),
    enabled: traderId.trim().length > 0,
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <LoadingState message="Loading your trader-profile exposure…" />;
  if (error) {
    return <ErrorState error={error} onRetry={() => void refetch()} title="Trader exposure unavailable" />;
  }
  if (!data || data.traderId !== traderId
    || data.dataScope !== "TRADER_PROFILE_OWNER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS") {
    return (
      <section className="rounded border border-amber-300 bg-amber-50 p-4" data-testid="trader-exposure-unavailable">
        <h2 className="font-semibold">Trader exposure unavailable</h2>
        <p className="mt-1 text-sm text-amber-950">
          The response did not confirm the requested trader-profile owner scope. No portfolio values are displayed.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded border bg-card p-4" aria-labelledby="trader-exposure-heading" data-testid="trader-exposure-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="trader-exposure-heading" className="font-semibold">Your trader-profile exposure</h2>
          <p className="mt-1 text-xs text-slate-600">Private to this trader-profile owner. Followers and other profile viewers cannot inspect these account positions.</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${exposureStateClass(data.state)}`} role="status">
          {exposureStateLabel(data.state)}
        </span>
      </div>

      <p className="text-xs text-slate-600">Snapshot as of {timestampLabel(data.asOf)} · {data.eligibleAccountCount} eligible non-sandbox account{data.eligibleAccountCount === 1 ? "" : "s"}</p>
      <p className="text-sm text-slate-700">{data.notice}</p>
      <p className="text-xs text-slate-600">Simulated records excluded · Cash balances excluded · Quote assets remain separate; no FX conversion is applied.</p>

      <button
        type="button"
        onClick={() => void refetch()}
        disabled={isFetching}
        className="rounded border px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-60"
      >
        {isFetching ? "Refreshing…" : "Refresh exposure"}
      </button>

      {data.state === "EMPTY" ? (
        <div className="rounded border p-4" data-testid="trader-exposure-empty">
          <h3 className="font-medium">No open exposure found</h3>
          <p className="mt-1 text-sm text-slate-600">No qualifying non-simulated open positions or working orders were returned for this trader profile.</p>
        </div>
      ) : (
        <>
          <div>
            <h3 className="font-medium">Positions and working orders</h3>
            <p className="mt-1 text-xs text-slate-600">Reference valuations use exact stored decimal strings and current instrument-linked data only. Unknown or stale amounts stay unavailable.</p>
          </div>
          {data.lines.length > 0 ? (
            <ExposureTable data={data} />
          ) : (
            <p className="rounded border p-4 text-sm text-slate-600">Exposure rows are unavailable because verified instrument metadata was not returned.</p>
          )}
          <div>
            <h3 className="font-medium">Totals by quote asset</h3>
            <p className="mt-1 text-xs text-slate-600">Different quote assets are never added together.</p>
            <QuoteTotals data={data} />
          </div>
        </>
      )}

      {(data.staleSymbols.length > 0 || data.unknownSymbols.length > 0) ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm" aria-label="Incomplete trader exposure values">
          <h3 className="font-medium">Some exposure amounts are withheld</h3>
          {data.staleSymbols.length > 0 ? <p className="mt-1">Stale reference data: {data.staleSymbols.join(", ")}</p> : null}
          {data.unknownSymbols.length > 0 ? <p className="mt-1">Missing or invalid valuation evidence: {data.unknownSymbols.join(", ")}</p> : null}
          <p className="mt-2 text-xs">Totals for affected quote assets remain unavailable until their required inputs are current and valid.</p>
        </div>
      ) : null}
    </section>
  );
}
