// # Responsibility: shows the server-resolved leverage and margin policy with explicit unavailable states.

import type { JSX } from 'react';
export interface LeveragePolicyPanelResult {
  allowed: boolean;
  effectiveMaximum: number | null;
  requestedLeverage: number;
  marginMode: 'CROSS' | 'ISOLATED';
  reason: string | null;
}

export function LeveragePolicyPanel({ result }: { result: LeveragePolicyPanelResult }): JSX.Element {
  return (
    <section className="rounded border bg-card p-4" data-testid="leverage-policy-panel">
      <h3 className="text-sm font-semibold">Leverage and margin policy</h3>
      <p className="mt-2 text-sm">Margin mode: {result.marginMode}</p>
      <p className="text-sm">Requested: {result.requestedLeverage}x · Maximum: {result.effectiveMaximum === null ? 'Not verified' : `${result.effectiveMaximum}x`}</p>
      <p role="status" className={`mt-2 text-xs ${result.allowed ? 'text-emerald-700' : 'text-amber-700'}`}>
        {result.allowed ? 'Request is within the current policy ceiling; normal risk checks still apply.' : result.reason ?? 'Leverage request is blocked.'}
      </p>
    </section>
  );
}
