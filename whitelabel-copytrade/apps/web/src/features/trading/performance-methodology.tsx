// # Responsibility: discloses the canonical period-linking method, source versions, observation age boundary, and evidence.

import type { JSX } from 'react';
export interface PerformanceMethodologyProps {
  methodology?: string | null;
  flowBoundary?: string | null;
  calculationVersion?: string | null;
  sourceCalculationVersion?: string | null;
  dataCompleteness?: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE' | null;
  sourceReferences?: readonly string[];
  unavailableReason?: string | null;
  baseCurrency?: string | null;
  asOf?: string | null;
  observationCount?: number | null;
  currentnessRule?: 'AS_OF_DISPLAYED_CURRENTNESS_NOT_ASSERTED' | null;
}

export function PerformanceMethodology({
  methodology = null,
  flowBoundary = null,
  calculationVersion = null,
  sourceCalculationVersion = null,
  dataCompleteness = 'UNAVAILABLE',
  sourceReferences = [],
  unavailableReason = null,
  baseCurrency = null,
  asOf = null,
  observationCount = null,
  currentnessRule = 'AS_OF_DISPLAYED_CURRENTNESS_NOT_ASSERTED',
}: PerformanceMethodologyProps): JSX.Element {
  const flowBoundaryVerified = flowBoundary === 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV';
  const complete = dataCompleteness === 'COMPLETE' && flowBoundaryVerified;
  const explanation = methodology === 'TIME_WEIGHTED_RETURN' && flowBoundaryVerified
    ? 'Time-weighted return links persisted, reconciled, closed-period returns using the disclosed external cash-flow boundary. Raw fills and unadjusted NAV snapshots are not substituted.'
    : methodology === 'TIME_WEIGHTED_RETURN'
      ? 'The API did not verify the cash-flow boundary convention. Do not interpret the reported period return as a verified time-weighted return.'
      : methodology
      ? `The persisted accounting record reports ${methodology}. Unsupported methods are not reinterpreted in the browser.`
      : 'The performance API did not supply a verified calculation methodology. Do not interpret absent fill-level PnL as zero, ROI, or time-weighted return.';

  return (
    <section aria-labelledby="performance-methodology-heading" className="rounded border bg-card p-4" data-testid="performance-methodology">
      <h3 id="performance-methodology-heading" className="text-sm font-semibold">How performance is calculated</h3>
      <p className="mt-2 text-xs leading-relaxed text-muted">{explanation}</p>
      <p className="mt-1 text-xs text-muted" data-testid="performance-flow-boundary">
        Cash-flow boundary: {flowBoundaryVerified
          ? 'Flows at period start are included in opening NAV; end-boundary flows are excluded from closing NAV; interior flows split the return chain.'
          : 'Unavailable; the return remains unverified.'}
      </p>
      <p className="mt-2 text-xs">Linking calculation version: <code>{calculationVersion ?? 'Not supplied by the accounting API'}</code></p>
      <p className="mt-1 text-xs">Source calculation version: <code>{sourceCalculationVersion ?? 'Unavailable'}</code></p>
      <p className="mt-1 text-xs" role="status" data-testid="performance-data-status">
        Data status: {complete ? 'Complete verified closed-period observations' : dataCompleteness === 'PARTIAL' ? 'Partial history; return and drawdown remain unavailable' : 'Verified complete return series unavailable'}
      </p>
      <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted">Base currency</dt>
          <dd>{baseCurrency ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt className="text-muted">{complete ? 'Included closed periods' : 'Candidate closed-period records'}</dt>
          <dd>{observationCount ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt className="text-muted">{complete ? 'Latest included period end' : 'Latest candidate period end'}</dt>
          <dd>{asOf ? <time dateTime={asOf}>{asOf}</time> : 'Unavailable'}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted" data-testid="performance-currentness-disclosure">
        {complete && asOf && currentnessRule === 'AS_OF_DISPLAYED_CURRENTNESS_NOT_ASSERTED'
          ? 'The verified result is historical as of the timestamp shown; current market-data freshness is not asserted.'
          : 'No verified as-of boundary is available for a currentness claim.'}
      </p>
      {!complete && unavailableReason ? (
        <p className="mt-1 text-xs text-muted" data-testid="performance-unavailable-reason">Unavailable reason: {unavailableReason}</p>
      ) : null}
      {sourceReferences.length > 0 ? (
        <details className="mt-2 text-xs">
          <summary>Calculation evidence ({sourceReferences.length})</summary>
          <ul className="mt-1 list-disc pl-5">{sourceReferences.map((reference) => <li key={reference}>{reference}</li>)}</ul>
        </details>
      ) : <p className="mt-1 text-xs text-muted">No source references were supplied for this calculation.</p>}
    </section>
  );
}
