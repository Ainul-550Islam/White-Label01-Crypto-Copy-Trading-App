// # Responsibility: plots persisted cumulative trader and benchmark returns without generating missing observations.

import type { PerformanceBenchmarkSeries } from '@/api/trading-api';

function chartPoints(values: number[], width: number, height: number, padding: number, min: number, max: number): string {
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) return '';
  const span = max - min || 1;
  return values.map((value, index) => {
    const x = padding + (index / (values.length - 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / span) * (height - padding * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

export function PerformanceBenchmarkChart({ series, loading = false }: { series: PerformanceBenchmarkSeries | null | undefined; loading?: boolean }): JSX.Element {
  if (loading || !series || series.status !== 'AVAILABLE' || series.dataCompleteness !== 'COMPLETE'
    || series.flowBoundary !== 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV'
    || series.observations.length < 2) {
    return (
      <section className="rounded border bg-card p-4" aria-labelledby="benchmark-heading" data-testid="performance-benchmark-chart">
        <h3 id="benchmark-heading" className="text-sm font-semibold">Market benchmark comparison</h3>
        <p role="status" className="mt-2 text-xs text-muted">{loading ? 'Loading persisted benchmark observations.' : series?.reason ?? 'A verified trader and benchmark series is not available for comparison.'}</p>
        <p className="mt-1 text-[11px] text-muted">No synthetic market-price or trader-return points are shown.</p>
      </section>
    );
  }

  const traderValues = series.observations.map((item) => Number(item.traderCumulativeReturnPercent));
  const benchmarkValues = series.observations.map((item) => Number(item.benchmarkCumulativeReturnPercent));
  const allValues = [...traderValues, ...benchmarkValues];
  if (allValues.some((value) => !Number.isFinite(value))) {
    return (
      <section className="rounded border bg-card p-4" aria-labelledby="benchmark-heading" data-testid="performance-benchmark-chart">
        <h3 id="benchmark-heading" className="text-sm font-semibold">Market benchmark comparison</h3>
        <p role="status" className="mt-2 text-xs text-muted">Verified values are outside the chart&apos;s supported display range.</p>
      </section>
    );
  }

  const width = 640;
  const height = 240;
  const padding = 24;
  const scaleMin = Math.min(0, ...allValues);
  const scaleMax = Math.max(0, ...allValues);
  const traderLine = chartPoints(traderValues, width, height, padding, scaleMin, scaleMax);
  const benchmarkLine = chartPoints(benchmarkValues, width, height, padding, scaleMin, scaleMax);
  return (
    <section className="rounded border bg-card p-4" aria-labelledby="benchmark-heading" data-testid="performance-benchmark-chart">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 id="benchmark-heading" className="text-sm font-semibold">Trader vs. market benchmark</h3>
          <p className="text-[11px] text-muted">{series.benchmarkKey} · {series.methodology ?? 'methodology not supplied'} · {series.calculationVersion ?? 'version not supplied'}</p>
          <p className="text-[11px] text-muted">Start-boundary flows are included in opening NAV; end-boundary flows are excluded from closing NAV.</p>
        </div>
        <div className="text-right text-[11px]">
          <p role="status">Data completeness: {series.dataCompleteness}</p>
          <p className="text-muted">As of {series.asOf ? <time dateTime={series.asOf}>{series.asOf}</time> : 'unavailable'}; currentness is not asserted.</p>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Cumulative return comparison for trader ${series.traderId} and benchmark ${series.benchmarkKey}`} className="mt-3 h-56 w-full">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="currentColor" opacity="0.25" />
        <polyline points={benchmarkLine} fill="none" stroke="#64748b" strokeWidth="3" />
        <polyline points={traderLine} fill="none" stroke="#0f766e" strokeWidth="3" />
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-2 w-4 bg-teal-700" />Trader cumulative return</span>
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-2 w-4 bg-slate-500" />{series.benchmarkKey} cumulative return</span>
      </div>
      {series.sourceReferences.length > 0 && <details className="mt-2 text-xs"><summary>Evidence references ({series.sourceReferences.length})</summary><ul className="mt-1 list-disc pl-5">{series.sourceReferences.map((reference) => <li key={reference}>{reference}</li>)}</ul></details>}
    </section>
  );
}
