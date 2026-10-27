'use client';
import type { JSX } from 'react';
import { useMemo } from 'react';
import { liquidationSeverity, type LiquidationAlert } from '@/api/copy-ops-api';
import { liquidationCopy, type LiquidationLocale } from './liquidation-copy';

export interface LiquidationRiskAlertProps {
  /** Only pass successfully validated data, never an error fallback. */
  alerts: LiquidationAlert[];
  onReduceExposure?: (positionId: string) => void;
  hideSafe?: boolean;
  locale?: LiquidationLocale;
}

export function LiquidationRiskAlert({ alerts, onReduceExposure, hideSafe = false, locale = 'en' }: LiquidationRiskAlertProps): JSX.Element {
  const t = liquidationCopy[locale];
  const ordered = useMemo(() => [...alerts].sort((a, b) => liquidationSeverity(b.bucket) - liquidationSeverity(a.bucket)), [alerts]);
  const attention = ordered.filter((alert) => alert.bucket !== 'SAFE');
  const safe = ordered.filter((alert) => alert.bucket === 'SAFE');
  const critical = ordered.some((alert) => alert.bucket === 'CRITICAL');
  if (alerts.length === 0) return <div className="rounded border bg-card p-3" role="status"><p>{t.empty}</p><p className="mt-1 text-sm text-muted">{t.emptyHint}</p></div>;
  const labels = { CRITICAL: t.critical, DANGER: t.danger, WATCH: t.watch, SAFE: t.safe, UNKNOWN: t.unknown };
  const tones = { CRITICAL:'border-red-400', DANGER:'border-orange-400', WATCH:'border-amber-400', SAFE:'border-emerald-300', UNKNOWN:'border-slate-400' };
  return <div className="grid gap-3">
    <div aria-live={critical ? 'assertive' : 'polite'} aria-atomic="false">
      {safe.length > 0 && (attention.length === 0 || hideSafe) && <p className="rounded border bg-card p-3 text-sm">{safe.length} · {t.safe}</p>}
    </div>
    {(hideSafe ? attention : ordered).map((alert) => <section key={alert.positionId}
      className={`rounded border bg-card p-3 text-sm ${tones[alert.bucket]}`}
      aria-label={`${t.section}: ${alert.symbol || t.account}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><span className="font-semibold"><bdi>{alert.symbol || t.account}</bdi></span>{' '}
          {alert.quantity !== null && <span><bdi>{alert.side} {alert.quantity}</bdi></span>}</div>
        <span className="rounded border border-current px-2 py-0.5 text-xs font-semibold">{labels[alert.bucket]}</span>
      </div>
      <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-3">
        <div><dt>{t.distance}</dt><dd className="font-mono"><bdi>{alert.distancePercent === null ? t.unknown : `${alert.distancePercent}%`}</bdi></dd></div>
        <div><dt>{t.liquidationPrice}</dt><dd className="font-mono"><bdi>{alert.liquidationPrice ?? t.notReported}</bdi></dd></div>
        <div><dt>{t.mark}</dt><dd className="font-mono"><bdi>{alert.markPrice ?? t.notReported}</bdi></dd></div>
      </dl>
      <p className="mt-2 text-xs">{alert.bucket === 'UNKNOWN' ? t.unknownAdvice : alert.bucket === 'SAFE' ? t.safeAdvice : t.alertAdvice}</p>
      {alert.containsSimulatedFills && <p className="mt-1 text-xs">{t.simulated}</p>}
      {alert.sourceUpdatedAt && <p className="mt-1 text-xs text-muted">{t.updated}{' '}<time dateTime={alert.sourceUpdatedAt}>{new Date(alert.sourceUpdatedAt).toLocaleString(locale)}</time></p>}
      {alert.bucket !== 'SAFE' && alert.quantity !== null && onReduceExposure && <button type="button" className="mt-2 rounded border px-3 py-1 text-xs font-medium" onClick={() => onReduceExposure(alert.positionId)}>{t.reduce}</button>}
    </section>)}
  </div>;
}
