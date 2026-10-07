// # Responsibility: renders the server-provided trader risk score, factor provenance and missing-data state.

import type { TraderRiskScore as TraderRiskScoreResult } from "@/api/trading-api";

export function TraderRiskScore({ result }: { result: TraderRiskScoreResult }): JSX.Element {
  const tone = result.band === "LOW"
    ? "text-emerald-700"
    : result.band === "CRITICAL" || result.band === "HIGH"
      ? "text-red-700"
      : "text-amber-700";
  const measuredFactorCount = result.factors.filter((factor) => factor.status === "MEASURED").length;

  return (
    <section className="rounded border bg-card p-4" data-testid="trader-risk-score" aria-labelledby="trader-risk-score-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="trader-risk-score-heading" className="text-sm font-semibold">Trader risk score</h3>
          <p className="mt-1 text-xs text-muted">Disclosure only. This score is not an investment recommendation or an execution approval.</p>
        </div>
        <span className={`text-sm font-semibold ${tone}`} data-testid="risk-band">
          {result.score === null ? "Unavailable" : `${result.score}/100 · ${result.band}`}
        </span>
      </div>
      <p className="mt-2 text-xs">
        Status: {result.status}; confidence: {result.confidence}; {measuredFactorCount} of {result.factors.length} factors measured.
        {result.asOf ? <> Observed at <time dateTime={result.asOf}>{result.asOf}</time>.</> : " Observation time unavailable."}
      </p>
      {result.confidence === "PARTIAL" && (
        <p className="mt-2 text-xs text-muted">Partial score uses measured factors only. Missing or stale factors are not imputed.</p>
      )}
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {result.factors.map((factor) => (
          <li key={factor.key} className="rounded border p-2 text-xs">
            <div className="font-medium">{factor.key}</div>
            <div>{factor.value ?? "Not available"} · {factor.status}</div>
            <div className="text-muted">{factor.source ? `Source: ${factor.source}` : "No verified source"}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
