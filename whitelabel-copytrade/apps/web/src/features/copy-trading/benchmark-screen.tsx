// # Responsibility: a trader's return against a benchmark, with the API's own statement of whether the comparison is available and what methodology produced it.
//
// The API can answer UNAVAILABLE with a reason, and that reason is the most important text on the
// screen: a chart drawn through a partial series would be a comparison the platform never made.
'use client';
import type { JSX } from 'react';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { copyTradingExtendedApi, type PerformanceBenchmarkSeries } from '@/api/copy-trading-extended-api';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { useCopy } from '@/i18n';

export const benchmarkQueryKey = (traderId: string, benchmarkKey?: string) => ['copy-trading', 'benchmark', traderId, benchmarkKey ?? ''] as const;

export function BenchmarkScreen({ initialTraderId = '' }: { initialTraderId?: string }): JSX.Element {
  const { t } = useCopy();
  const [traderId, setTraderId] = useState(initialTraderId);
  const [requested, setRequested] = useState(initialTraderId.trim());
  const query = useQuery({
    queryKey: benchmarkQueryKey(requested),
    queryFn: () => copyTradingExtendedApi.getTraderBenchmark(requested),
    enabled: requested.length > 0,
    retry: false,
  });
  const series: PerformanceBenchmarkSeries | undefined = query.data;

  return (
    <section aria-labelledby="benchmark-heading" className="space-y-4">
      <header>
        <h2 id="benchmark-heading" className="text-lg font-semibold">{t('benchmark.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('benchmark.intro')}</p>
      </header>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setRequested(traderId.trim());
        }}
      >
        <label className="block text-sm">
          <span className="font-medium">{t('benchmark.traderId')}</span>
          <input className="mt-1 w-full rounded border px-3 py-2" value={traderId} onChange={(event) => setTraderId(event.target.value)} />
        </label>
        <button type="submit" className="rounded bg-primary px-3 py-2 text-sm text-white" disabled={traderId.trim().length === 0}>
          {t('benchmark.load')}
        </button>
      </form>

      {requested.length === 0 && <EmptyState title={t('benchmark.title')} description={t('benchmark.intro')} />}
      {requested.length > 0 && query.isPending && <LoadingState message={t('common.loading')} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {series && series.status === 'UNAVAILABLE' && (
        <EmptyState title={t('benchmark.unavailable')} description={series.reason ?? t('benchmark.unavailable')} />
      )}

      {series && series.status === 'AVAILABLE' && (
        <div aria-live="polite" className="space-y-2">
          <dl className="grid gap-2 sm:grid-cols-3">
            <div><dt className="text-xs text-muted">{t('benchmark.benchmarkKey')}</dt><dd className="text-sm">{series.benchmarkKey ?? t('common.unavailable')}</dd></div>
            <div><dt className="text-xs text-muted">{t('benchmark.methodology')}</dt><dd className="text-sm">{series.methodology ?? t('common.unavailable')}</dd></div>
            <div><dt className="text-xs text-muted">{t('benchmark.completeness')}</dt><dd className="text-sm">{series.dataCompleteness}</dd></div>
            <div><dt className="text-xs text-muted">{t('benchmark.asOf')}</dt><dd className="text-sm">{series.asOf ?? t('common.unavailable')}</dd></div>
          </dl>
          {series.observations.length === 0 ? (
            <EmptyState title={t('benchmark.unavailable')} description={series.reason ?? t('benchmark.unavailable')} />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className="text-left">{t('benchmark.period')}</th>
                  <th scope="col" className="text-left">{t('benchmark.traderReturn')}</th>
                  <th scope="col" className="text-left">{t('benchmark.benchmarkReturn')}</th>
                </tr>
              </thead>
              <tbody>
                {series.observations.map((observation) => (
                  <tr key={`${observation.periodStart}-${observation.periodEnd}`}>
                    <td>{observation.periodStart} – {observation.periodEnd}</td>
                    <td>{observation.traderPeriodReturnPercent}</td>
                    <td>{observation.benchmarkPeriodReturnPercent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-muted">{series.currentnessRule}</p>
        </div>
      )}
    </section>
  );
}
