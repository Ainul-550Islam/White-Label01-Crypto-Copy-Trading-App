// # Responsibility: lets customers select a 7D, 30D, or 90D ranking window and explains its measured-return methodology.

import type { TraderRankingMethodology, TraderRankingTimeframe } from "@/api/trading-api";

export function TraderRankingControls({
  timeframe,
  onTimeframeChange,
  methodology,
}: {
  timeframe: TraderRankingTimeframe;
  onTimeframeChange: (timeframe: TraderRankingTimeframe) => void;
  methodology?: TraderRankingMethodology;
}): JSX.Element {
  return (
    <section className="rounded border bg-card p-3 text-xs" aria-label="Ranking timeframe and methodology" data-testid="trader-ranking-controls">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="trader-ranking-timeframe" className="font-medium">Ranking timeframe</label>
        <select
          id="trader-ranking-timeframe"
          aria-label="Ranking timeframe"
          value={timeframe}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "7D" || value === "30D" || value === "90D") onTimeframeChange(value);
          }}
          className="rounded border px-2 py-1.5"
        >
          <option value="7D">7 days</option>
          <option value="30D">30 days</option>
          <option value="90D">90 days</option>
        </select>
        {methodology ? (
          <span className="rounded border px-2 py-1" data-testid="ranking-methodology-status">
            {methodology.status}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-muted">
        Ranking method: compounded time-weighted return from complete, reconciled, closed accounting periods. Only exact contiguous coverage of the selected window is ranked; missing evidence is unranked, never estimated.
      </p>
      {methodology ? (
        <p className="mt-1 text-muted" data-testid="ranking-minimum-period-count">
          Ranking requires a minimum of {methodology.minimumPeriodCount} closed, reconciled periods.
        </p>
      ) : null}
      {methodology?.asOf ? (
        <p className="mt-1 text-muted">
          Selected window: <time dateTime={methodology.windowStart ?? undefined}>{methodology.windowStart ?? "unavailable"}</time> through{' '}
          <time dateTime={methodology.asOf}>{methodology.asOf}</time>. This is the latest persisted as-of boundary, not a claim of current market data.
        </p>
      ) : methodology?.reason ? (
        <p className="mt-1 text-muted">Window data unavailable: {methodology.reason}</p>
      ) : null}
    </section>
  );
}
