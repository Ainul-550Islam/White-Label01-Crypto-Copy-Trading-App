// # Responsibility: shows how far each open position is from liquidation, and treats "we cannot measure it" as its own warning rather than as safety.
//
// THE ONE RULE
// ------------
// UNKNOWN is not SAFE. A position whose mark price or liquidation price the venue
// has not reported is not "probably fine" - it is a position nobody can see the
// edge of. The API says so explicitly (bucket UNKNOWN, `unavailableReason` set),
// and this component renders it with its own wording, its own (neutral, not
// green) tone, and a live-region announcement. Showing a green bar for an
// unmeasured position is the failure mode this whole card exists to prevent.
//
// The card is also deliberately quiet when everything is SAFE: a permanent
// warning banner that never changes trains people to stop reading it. Only WATCH
// and worse interrupt; SAFE positions collapse to a single line.
//
// Distances are rendered from the decimal strings the API sent. No arithmetic
// happens here, because a percentage recomputed in the browser can disagree with
// the number the risk engine actually used to decide.
'use client';
import type { JSX } from 'react';

import { useMemo } from 'react';

import type { LiquidationAlert } from '@/api/copy-ops-api';
import { liquidationSeverity } from '@/api/copy-ops-api';
import { EmptyState } from '@/components/empty-state';

export type LiquidationBucket = 'SAFE' | 'WATCH' | 'DANGER' | 'CRITICAL' | 'UNKNOWN';

const BUCKET_COPY: Record<LiquidationBucket, { label: string; tone: string; advice: string }> = {
  CRITICAL: {
    label: 'Critical',
    tone: 'border-red-400 bg-red-50 text-red-900',
    advice: 'A small adverse move liquidates this position. Reduce it or add margin now.',
  },
  DANGER: {
    label: 'Danger',
    tone: 'border-orange-400 bg-orange-50 text-orange-900',
    advice: 'This position is close to liquidation. Acting early is far cheaper than acting after.',
  },
  WATCH: {
    label: 'Watch',
    tone: 'border-amber-300 bg-amber-50 text-amber-900',
    advice: 'Margin health is slipping. No action needed yet, but keep an eye on it.',
  },
  SAFE: {
    label: 'Safe',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    advice: 'Comfortably away from liquidation at the last mark price.',
  },
  UNKNOWN: {
    label: 'Unknown',
    tone: 'border-slate-300 bg-slate-50 text-slate-900',
    advice: 'The distance to liquidation could not be measured, so treat this position as unmonitored.',
  },
};

function normaliseBucket(bucket: string): LiquidationBucket {
  const upper = bucket.toUpperCase();
  return (['SAFE', 'WATCH', 'DANGER', 'CRITICAL', 'UNKNOWN'] as const).includes(upper as LiquidationBucket)
    ? (upper as LiquidationBucket)
    : 'UNKNOWN';
}

export interface LiquidationRiskAlertProps {
  alerts: LiquidationAlert[];
  /** Called when the customer chooses to reduce exposure for a position. */
  onReduceExposure?: (positionId: string) => void;
  /** Hide SAFE rows entirely (the default keeps a one-line summary instead). */
  hideSafe?: boolean;
}

export function LiquidationRiskAlert({
  alerts,
  onReduceExposure,
  hideSafe = false,
}: LiquidationRiskAlertProps): JSX.Element {
  const ordered = useMemo(
    () => [...alerts].sort((a, b) => liquidationSeverity(b.bucket) - liquidationSeverity(a.bucket)),
    [alerts],
  );
  const attention = ordered.filter((alert) => normaliseBucket(alert.bucket) !== 'SAFE');
  const safe = ordered.filter((alert) => normaliseBucket(alert.bucket) === 'SAFE');
  const critical = ordered.filter((alert) => normaliseBucket(alert.bucket) === 'CRITICAL');

  if (alerts.length === 0) {
    return (
      <EmptyState
        title="No open positions"
        description="Liquidation alerts appear here for each position you hold."
      />
    );
  }

  return (
    <div className="grid gap-3">
      {/* CRITICAL is announced: it is the one state where a customer who is not
          looking at this card needs to be told. */}
      <div aria-live={critical.length > 0 ? 'assertive' : 'polite'} aria-atomic="false">
        {attention.length === 0 ? (
          <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            {safe.length} position{safe.length === 1 ? '' : 's'} comfortably away from liquidation.
          </p>
        ) : hideSafe && safe.length > 0 ? (
          <p className="text-xs text-muted">
            {safe.length} further position{safe.length === 1 ? '' : 's'} safely away from liquidation.
          </p>
        ) : null}
      </div>

      {(hideSafe ? attention : ordered).map((alert) => {
        const bucket = normaliseBucket(alert.bucket);
        const copy = BUCKET_COPY[bucket];
        const distance = alert.distancePercent;
        return (
          <section
            key={alert.positionId}
            className={`rounded border p-3 text-sm ${copy.tone}`}
            aria-label={`Liquidation risk for ${alert.symbol}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold">{alert.symbol}</span>{' '}
                <span className="opacity-80">
                  {alert.side} {alert.quantity}
                </span>
              </div>
              <span className="rounded border border-current px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
                {copy.label}
              </span>
            </div>

            <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-3">
              <div>
                <dt className="uppercase tracking-wide opacity-70">Distance to liquidation</dt>
                <dd className="font-mono">{distance === null ? 'Unknown' : `${distance}%`}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide opacity-70">Liquidation price</dt>
                <dd className="font-mono">{alert.liquidationPrice ?? 'Not reported'}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide opacity-70">Mark price</dt>
                <dd className="font-mono">{alert.markPrice ?? 'Not reported'}</dd>
              </div>
            </dl>

            <p className="mt-2 text-xs">{bucket === 'UNKNOWN' && alert.unavailableReason ? alert.unavailableReason : copy.advice}</p>

            {bucket !== 'SAFE' && onReduceExposure && (
              <button
                type="button"
                className="mt-2 rounded border border-current px-3 py-1 text-xs font-medium"
                onClick={() => onReduceExposure(alert.positionId)}
              >
                Reduce exposure
              </button>
            )}

            <p className="mt-1 text-[11px] opacity-60">
              Evaluated {alert.evaluatedAt ? new Date(alert.evaluatedAt).toLocaleString() : 'at an unknown time'}
            </p>
          </section>
        );
      })}
    </div>
  );
}
