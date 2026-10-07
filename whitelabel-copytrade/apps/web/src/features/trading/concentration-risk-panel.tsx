// # Responsibility: presents the signed-in customer's measured concentration and aligned-candle correlation with explicit stale and unknown states.

'use client';

import { useQuery } from '@tanstack/react-query';
import {
  riskAnalysisApi,
  type CustomerConcentrationMetric,
  type CustomerRiskEvidenceState,
  type CustomerRiskValueState,
  type CustomerCorrelationPair,
} from '@/api/risk-analysis-api';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';

export const CUSTOMER_RISK_ANALYSIS_QUERY_KEY = ['customer-risk-analysis', 'my'] as const;

function stateClass(state: CustomerRiskEvidenceState | CustomerRiskValueState | string): string {
  if (state === 'CURRENT' || state === 'NORMAL') return 'border-green-200 bg-green-50 text-green-800';
  if (state === 'STALE') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (state === 'HIGH' || state === 'BLOCKED' || state === 'CRITICAL') return 'border-red-200 bg-red-50 text-red-800';
  return 'border-gray-200 bg-gray-50 text-gray-700';
}

function stateLabel(state: CustomerRiskEvidenceState | CustomerRiskValueState | string): string {
  if (state === 'CURRENT') return 'Measured with current evidence';
  if (state === 'STALE') return 'Stale evidence — value withheld';
  if (state === 'EMPTY') return 'No open positions to measure';
  if (state === 'NORMAL') return 'Measured — within threshold';
  if (state === 'HIGH') return 'Measured — threshold exceeded';
  if (state === 'BLOCKED') return 'Threshold breached';
  if (state === 'CRITICAL') return 'Critical';
  return 'Unknown or incomplete — value withheld';
}

function utcTimestamp(value: string | null | undefined): string {
  if (!value) return 'Unavailable';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return 'Unavailable';
  return `${parsed.toISOString()} UTC`;
}

function notional(value: string | null, quoteAsset: string | null): string {
  if (value === null || !quoteAsset) return 'Unavailable';
  return `${value} ${quoteAsset}`;
}

function concentrationValue(metric: CustomerConcentrationMetric): string {
  if (metric.state !== 'CURRENT' || metric.currentPercent === null) return 'Unavailable';
  return `${metric.currentPercent}%`;
}

function concentrationAmount(metric: CustomerConcentrationMetric): string {
  if (metric.state !== 'CURRENT') return 'Unavailable';
  return notional(metric.currentNotional, metric.quoteAsset);
}

function thresholdLabel(metric: CustomerConcentrationMetric): string {
  if (metric.thresholdPercent === null) return 'Not configured';
  return `${metric.thresholdPercent}%`;
}

function breachLabel(metric: CustomerConcentrationMetric): string {
  if (metric.state !== 'CURRENT' || metric.isBreach === null) return 'Not classified';
  return metric.isBreach ? 'Threshold exceeded' : 'Within threshold';
}

function CorrelationValue({ pair }: { pair: CustomerCorrelationPair }): JSX.Element {
  if (pair.isUnknown || pair.correlation === null || pair.isStale || pair.state === 'UNKNOWN' || pair.state === 'STALE') {
    return <span>Unavailable</span>;
  }
  return <span className="font-mono">{pair.correlation}</span>;
}

function ConcentrationTable({ metrics }: { metrics: CustomerConcentrationMetric[] }): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[1040px] text-sm">
        <caption className="sr-only">Concentration measured within each quote asset, with freshness and source evidence</caption>
        <thead className="border-b bg-gray-50 text-left text-xs uppercase text-muted">
          <tr>
            <th className="p-3">Dimension</th>
            <th className="p-3">Exposure group</th>
            <th className="p-3">Quote asset</th>
            <th className="p-3 text-right">Gross position notional</th>
            <th className="p-3 text-right">Share of quote-asset gross</th>
            <th className="p-3 text-right">Threshold</th>
            <th className="p-3">Assessment</th>
            <th className="p-3">Evidence as of / state</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric, index) => (
            <tr key={`${metric.quoteAsset ?? 'unassigned'}:${metric.dimension}:${metric.key}:${index}`} className="border-b align-top last:border-0">
              <td className="p-3 font-medium">{metric.dimension}</td>
              <td className="p-3">
                <div>{metric.key}</div>
                <div className="mt-1 text-xs text-muted">{metric.evidenceSymbols.join(', ') || 'Instrument identity unavailable'}</div>
              </td>
              <td className="p-3">{metric.quoteAsset ?? 'Unavailable'}</td>
              <td className="p-3 text-right font-mono">{concentrationAmount(metric)}</td>
              <td className="p-3 text-right font-mono">{concentrationValue(metric)}</td>
              <td className="p-3 text-right font-mono">{thresholdLabel(metric)}</td>
              <td className="p-3">
                <div>{breachLabel(metric)}</div>
                <span className={`mt-2 inline-flex rounded-full border px-2 py-1 text-xs ${stateClass(metric.state)}`}>
                  {stateLabel(metric.state)}
                </span>
              </td>
              <td className="p-3">
                <div>{utcTimestamp(metric.observedAt)}</div>
                <div className="mt-1 text-xs text-muted">{metric.source === 'MARKET_DATA_1M_CANDLE_CLOSE' ? '1-minute candle close' : 'Source unavailable'}</div>
                <div className="mt-1 max-w-[360px] text-xs text-muted">{metric.reason}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CorrelationTable({ pairs }: { pairs: CustomerCorrelationPair[] }): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[900px] text-sm">
        <caption className="sr-only">Correlation based on aligned, fresh daily candle-close returns</caption>
        <thead className="border-b bg-gray-50 text-left text-xs uppercase text-muted">
          <tr>
            <th className="p-3">Instrument pair</th>
            <th className="p-3 text-right">Pearson correlation</th>
            <th className="p-3 text-right">Aligned returns</th>
            <th className="p-3 text-right">Threshold</th>
            <th className="p-3">State</th>
            <th className="p-3">Daily candle evidence as of</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((pair) => (
            <tr key={pair.pairKey} className="border-b align-top last:border-0">
              <td className="p-3">
                <div className="font-medium">{pair.pairKey}</div>
                <div className="mt-1 text-xs text-muted">{pair.sourceMethodology ?? 'Aligned daily close returns'}</div>
              </td>
              <td className="p-3 text-right"><CorrelationValue pair={pair} /></td>
              <td className="p-3 text-right font-mono">{pair.observations}</td>
              <td className="p-3 text-right font-mono">{pair.threshold === null ? 'Not configured' : pair.threshold}</td>
              <td className="p-3">
                <span className={`rounded-full border px-2 py-1 text-xs ${stateClass(pair.state)}`}>
                  {stateLabel(pair.state)}
                </span>
                <div className="mt-2 max-w-[360px] text-xs text-muted">{pair.reason}</div>
              </td>
              <td className="p-3">
                <div>{utcTimestamp(pair.sourceTimestamp)}</div>
                <div className="mt-1 text-xs text-muted">Interval {pair.sourceInterval ?? 'unavailable'} · max age {pair.sourceMaxAgeMs === null || pair.sourceMaxAgeMs === undefined ? 'unavailable' : `${Math.round(pair.sourceMaxAgeMs / 3_600_000)} hours`}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ConcentrationRiskPanel(): JSX.Element {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: CUSTOMER_RISK_ANALYSIS_QUERY_KEY,
    queryFn: () => riskAnalysisApi.getMyRiskAnalysis(),
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <LoadingState message="Loading your concentration and correlation evidence…" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} title="Risk analysis unavailable" />;
  if (!data) return <ErrorState error={new Error('No risk-analysis response was returned.')} onRetry={() => void refetch()} />;

  const concentration = data.concentration;
  const correlation = data.correlation;

  return (
    <section className="space-y-6" data-testid="concentration-risk-panel" aria-labelledby="customer-risk-analysis-heading">
      <div className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="customer-risk-analysis-heading" className="text-lg font-semibold">Concentration and correlation risk</h2>
            <p className="mt-1 text-sm text-muted">Owner-scoped, non-sandbox, non-simulated open-position evidence. Calculated {utcTimestamp(data.requestedAt)}.</p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="rounded border px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-60"
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <p className="mt-3 text-sm text-muted">Concentration is shown only within the same quote asset; different quote currencies are never added without an FX source. Correlation uses observed daily candle returns and is not a hedge guarantee, portfolio-PnL correlation, trading recommendation, or substitute for execution-risk checks.</p>
      </div>

      <section className="space-y-3" aria-labelledby="customer-concentration-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="customer-concentration-heading" className="text-base font-semibold">Measured concentration</h3>
            <p className="text-sm text-muted">Exact-decimal gross position notionals use fresh, instrument-linked 1-minute candle closes. Working orders are excluded from this concentration denominator.</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs ${stateClass(concentration.state)}`} role="status">
            {stateLabel(concentration.state)}
          </span>
        </div>
        {concentration.metrics.length > 0 ? (
          <ConcentrationTable metrics={concentration.metrics} />
        ) : (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted">{concentration.state === 'EMPTY' ? 'No open position is available for concentration measurement.' : 'Concentration values are unavailable because no complete measured groups were returned.'}</p>
        )}
        <p className="text-xs text-muted">{concentration.notice}</p>
        {(concentration.staleSymbols.length > 0 || concentration.unknownSymbols.length > 0) && (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs" aria-label="Incomplete concentration source symbols">
            {concentration.staleSymbols.length > 0 && <p>Stale sources: {concentration.staleSymbols.join(', ')}</p>}
            {concentration.unknownSymbols.length > 0 && <p className="mt-1">Unknown sources: {concentration.unknownSymbols.join(', ')}</p>}
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="customer-correlation-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="customer-correlation-heading" className="text-base font-semibold">Measured correlation</h3>
            <p className="text-sm text-muted">{correlation.method} · {correlation.interval} candles · minimum {correlation.minObservations} aligned daily return observations · maximum source age {Math.round(correlation.maxSourceAgeMs / 3_600_000)} hours.</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs ${stateClass(correlation.state)}`} role="status">
            {stateLabel(correlation.state)}
          </span>
        </div>
        {correlation.pairs.length > 0 ? (
          <CorrelationTable pairs={correlation.pairs} />
        ) : (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted">
            {correlation.state === 'EMPTY'
              ? 'No eligible open positions were found for correlation analysis.'
              : 'No eligible instrument pair has enough verified aligned daily candle evidence. Correlation is unavailable, not zero.'}
          </p>
        )}
        {(correlation.omittedPositionCount ?? 0) > 0 && (
          <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs">{correlation.omittedPositionCount} open position record(s) did not have verifiable tenant instrument identity or quantity; portfolio correlation coverage is incomplete.</p>
        )}
        {(correlation.truncatedPairCount ?? 0) > 0 && (
          <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs">{correlation.truncatedPairCount} eligible pair(s) were not evaluated because the service caps each request at 20 pairs. The result is incomplete, not a complete correlation matrix.</p>
        )}
        <p className="text-xs text-muted">{correlation.notice}</p>
      </section>
    </section>
  );
}
