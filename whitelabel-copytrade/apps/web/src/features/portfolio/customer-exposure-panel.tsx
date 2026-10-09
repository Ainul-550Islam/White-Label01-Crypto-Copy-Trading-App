// # Responsibility: presents the signed-in user's own current exposure while withholding stale, unknown, and cross-currency totals.

'use client';
import type { JSX } from 'react';

import { useQuery } from '@tanstack/react-query';
import { customerExposureApi, type CustomerExposureLine, type CustomerExposureState, type CustomerExposureValueState } from '@/api/customer-exposure-api';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';

export const CUSTOMER_EXPOSURE_QUERY_KEY = ['customer-exposure', 'my'] as const;

function stateClass(state: CustomerExposureState | CustomerExposureValueState): string {
  if (state === 'CURRENT') return 'border-green-200 bg-green-50 text-green-800';
  if (state === 'STALE') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (state === 'UNKNOWN') return 'border-red-200 bg-red-50 text-red-800';
  return 'border-gray-200 bg-gray-50 text-gray-700';
}

function stateLabel(state: CustomerExposureState | CustomerExposureValueState): string {
  if (state === 'CURRENT') return 'Current reference data';
  if (state === 'STALE') return 'Stale price data';
  if (state === 'UNKNOWN') return 'Valuation unavailable';
  return 'No open exposure';
}

function amount(value: string | null, quoteAsset: string | null): string {
  if (value === null || !quoteAsset) return 'Unavailable';
  return `${value} ${quoteAsset}`;
}

function renderLineState(line: CustomerExposureLine): string {
  if (line.state === 'CURRENT') return 'Current';
  if (line.state === 'STALE') return 'Stale';
  return 'Unknown';
}

function referenceTimestamp(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '—';
  return `${parsed.toISOString()} UTC`;
}

function ExposureLines({ lines }: { lines: CustomerExposureLine[] }): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[980px] text-sm">
        <caption className="sr-only">Exposure by instrument and venue, with market-data provenance and quote asset shown</caption>
        <thead className="border-b bg-gray-50 text-left text-xs uppercase text-muted">
          <tr>
            <th className="p-3">Instrument</th>
            <th className="p-3">Venue / market</th>
            <th className="p-3 text-right">Net quantity</th>
            <th className="p-3 text-right">1-minute close reference</th>
            <th className="p-3 text-right">Gross positions</th>
            <th className="p-3 text-right">Open-order commitment</th>
            <th className="p-3 text-right">Combined total</th>
            <th className="p-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={`${line.venue}:${line.symbol}:${line.marketType ?? 'unknown'}:${line.quoteAsset ?? 'unknown'}`} className="border-b last:border-0">
              <td className="p-3">
                <div className="font-medium">{line.symbol}</div>
                <div className="text-xs text-muted">{line.baseAsset ?? 'Base asset unavailable'} / {line.quoteAsset ?? 'Quote asset unavailable'}</div>
              </td>
              <td className="p-3">
                <div>{line.venue}</div>
                <div className="text-xs text-muted">{line.marketType ?? 'Market type unavailable'}</div>
              </td>
              <td className="p-3 text-right font-mono">{line.netQuantity ?? 'Unavailable'}</td>
              <td className="p-3 text-right">
                {line.price === null ? 'Unavailable' : <span className="font-mono">{line.price} {line.quoteAsset ?? ''}</span>}
                <div className="text-xs text-muted">{referenceTimestamp(line.priceTimestamp)}</div>
              </td>
              <td className="p-3 text-right font-mono">{amount(line.grossPositionNotional, line.quoteAsset)}</td>
              <td className="p-3 text-right">
                <div className="font-mono">{amount(line.openOrderCommitment, line.quoteAsset)}</div>
                {line.openOrderCount > 0 && (
                  <div className="text-xs text-muted">
                    {line.openOrderCount} open · {line.openOrderCommitmentBasis === 'ORDER_PRICE'
                      ? 'order price'
                      : line.openOrderCommitmentBasis === 'MARKET_DATA_1M_CANDLE_CLOSE'
                        ? '1-minute close reference'
                        : line.openOrderCommitmentBasis === 'MIXED'
                          ? 'mixed reference basis'
                          : 'basis unavailable'}
                  </div>
                )}
              </td>
              <td className="p-3 text-right font-mono">{amount(line.totalNotional, line.quoteAsset)}</td>
              <td className="p-3">
                <span className={`rounded-full border px-2 py-1 text-xs ${stateClass(line.state)}`}>
                  {renderLineState(line)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CustomerExposurePanel(): JSX.Element {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: CUSTOMER_EXPOSURE_QUERY_KEY,
    queryFn: () => customerExposureApi.getMyExposure(),
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <LoadingState message="Loading your exposure…" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} title="Exposure unavailable" />;
  if (!data) return <ErrorState error={new Error('No exposure response was returned.')} onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6" data-testid="customer-exposure-panel">
      <section className="rounded-lg border bg-card p-5" aria-labelledby="exposure-state-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="exposure-state-heading" className="text-lg font-semibold">Exposure data status</h2>
            <p className="mt-1 text-sm text-muted">As of {referenceTimestamp(data.asOf)}</p>
          </div>
          <div className={`rounded-full border px-3 py-1 text-sm font-medium ${stateClass(data.state)}`} role="status">
            {stateLabel(data.state)}
          </div>
        </div>
        <p className="mt-4 text-sm text-muted">{data.notice}</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
          <span>{data.eligibleAccountCount} eligible non-sandbox account{data.eligibleAccountCount === 1 ? '' : 's'}</span>
          <span>Simulated records excluded</span>
          <span>Cash balances excluded</span>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="rounded border px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-60"
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </section>

      {data.state === 'EMPTY' ? (
        <section className="rounded-lg border bg-card p-8 text-center" data-testid="exposure-empty-state">
          <h3 className="font-semibold">No open exposure found</h3>
          <p className="mt-2 text-sm text-muted">
            {data.eligibleAccountCount === 0
              ? 'There are no non-deleted non-sandbox exchange accounts linked to your profile.'
              : 'No non-simulated open positions or working orders were found in your eligible accounts.'}
          </p>
        </section>
      ) : (
        <>
          <section className="space-y-3" aria-labelledby="exposure-lines-heading">
            <div>
              <h2 id="exposure-lines-heading" className="text-lg font-semibold">Positions and open orders</h2>
              <p className="text-sm text-muted">Position values are grouped by venue and instrument. Open orders are shown as separate commitments and are not netted against positions.</p>
            </div>
            {data.lines.length > 0 ? (
              <ExposureLines lines={data.lines} />
            ) : (
              <p className="rounded border p-4 text-sm text-muted">Rows are unavailable because instrument metadata could not be verified.</p>
            )}
          </section>

          <section className="rounded-lg border bg-card p-5" aria-labelledby="exposure-totals-heading">
            <h2 id="exposure-totals-heading" className="text-lg font-semibold">Totals by quote asset</h2>
            <p className="mt-1 text-sm text-muted">Different quote assets are not added together. No FX rate is assumed.</p>
            {data.totalsByQuoteAsset.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No quote-currency total is available.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="border-b text-left text-xs uppercase text-muted">
                    <tr>
                      <th className="py-2">Quote asset</th>
                      <th className="py-2 text-right">Gross positions</th>
                      <th className="py-2 text-right">Open-order commitments</th>
                      <th className="py-2 text-right">Combined total</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.totalsByQuoteAsset.map((total) => (
                      <tr key={total.quoteAsset} className="border-b last:border-0">
                        <td className="py-3 font-medium">{total.quoteAsset}</td>
                        <td className="py-3 text-right font-mono">{amount(total.grossPositionNotional, total.quoteAsset)}</td>
                        <td className="py-3 text-right font-mono">{amount(total.openOrderCommitment, total.quoteAsset)}</td>
                        <td className="py-3 text-right font-mono">{amount(total.totalNotional, total.quoteAsset)}</td>
                        <td className="py-3">
                          <span className={`rounded-full border px-2 py-1 text-xs ${stateClass(total.state)}`}>
                            {stateLabel(total.state)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {(data.staleSymbols.length > 0 || data.unknownSymbols.length > 0) && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm" aria-label="Incomplete exposure symbols">
          <h2 className="font-semibold">Some exposure values are withheld</h2>
          {data.staleSymbols.length > 0 && <p className="mt-2">Stale prices: {data.staleSymbols.join(', ')}</p>}
          {data.unknownSymbols.length > 0 && <p className="mt-2">Missing or invalid prices/data: {data.unknownSymbols.join(', ')}</p>}
          <p className="mt-2 text-xs">Totals for affected quote assets are not shown until all required valuation inputs are current and valid.</p>
        </section>
      )}
    </div>
  );
}
