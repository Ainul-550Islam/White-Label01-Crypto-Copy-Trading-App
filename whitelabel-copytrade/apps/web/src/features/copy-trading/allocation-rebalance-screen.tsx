// # Responsibility: the allocation-rebalance screen - enter what each trader holds and the weight you want, see the API's arithmetic, and be told plainly that nothing was executed.
//
// The preview is the whole feature and it is deliberately not an action: the route computes target and
// delta values from figures the caller typed and labels the result CLIENT_SUPPLIED_UNVERIFIED. So the
// screen does three things a "rebalance" button usually does not:
//
//   * it keeps the exact input that produced the numbers, and marks the answer stale the moment a field
//     changes - a preview that silently describes other numbers is worse than no preview;
//   * it shows the persisted valuation route next to it, so the customer can see what the platform
//     actually measures, and which of the two the figures came from;
//   * it says, in place, that acting on the preview means placing the orders yourself.
'use client';
import type { JSX } from 'react';

import { useMutation } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';

import {
  copyTradingExtendedApi,
  DECIMAL_STRING,
  type PersistedPortfolioValuation,
  type RebalancePreviewLine,
} from '@/api/copy-trading-extended-api';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { useCopy } from '@/i18n';
import { newIdempotencyKey } from '@/lib/idempotency-key';

export interface Draft {
  traderId: string;
  currentValue: string;
  targetWeightBps: string;
  priceAvailable: boolean;
}

const EMPTY_DRAFT: Draft = { traderId: '', currentValue: '', targetWeightBps: '', priceAvailable: true };

/** The exact input a preview was produced from, so a changed form can be recognised as stale. */
export function rebalanceFingerprint(total: string, rows: readonly Draft[]): string {
  // Built from the values the request would carry, not from the raw input: adding a space to the
  // portfolio value does not make the answer wrong, but changing a weight does.
  return JSON.stringify([
    total.trim(),
    rows.map((row) => [row.traderId.trim(), row.currentValue.trim(), row.targetWeightBps.trim(), row.priceAvailable]),
  ]);
}

/** A preview describes the input it was produced from; once the form moves on, it describes nothing. */
export function isPreviewStale(previewedFor: string | null, current: string): boolean {
  return previewedFor !== null && previewedFor !== current;
}

/** The payload the preview route receives, built from the draft exactly as typed (trimmed, never rounded). */
export function buildPreviewRequest(total: string, rows: readonly Draft[]): { totalValue: string; allocations: Array<{ traderId: string; currentValue: string; targetWeightBps: number; priceAvailable: boolean }> } {
  return {
    totalValue: total.trim(),
    allocations: rows.map((row) => ({
      traderId: row.traderId.trim(),
      currentValue: row.currentValue.trim(),
      targetWeightBps: Number(row.targetWeightBps),
      priceAvailable: row.priceAvailable,
    })),
  };
}

export function AllocationRebalanceScreen(): JSX.Element {
  const { t } = useCopy();
  const [totalValue, setTotalValue] = useState('');
  const [quoteAsset, setQuoteAsset] = useState('USDT');
  const [rows, setRows] = useState<Draft[]>([{ ...EMPTY_DRAFT }]);
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ lines: RebalancePreviewLine[]; source: string; at: string } | null>(null);
  const [previewedFor, setPreviewedFor] = useState<string | null>(null);
  const [valuation, setValuation] = useState<PersistedPortfolioValuation | null>(null);
  const key = useRef<string>(newIdempotencyKey('rebalance'));

  const current = rebalanceFingerprint(totalValue, rows);
  const stale = isPreviewStale(previewedFor, current);

  const previewMutation = useMutation({
    // A preview is a POST and carries a stable key until it succeeds, so a retry after a timeout is
    // recognised as the same request rather than a second preview of the same figures.
    mutationFn: (input: { totalValue: string; rows: Draft[] }) =>
      copyTradingExtendedApi.previewAllocationRebalance(buildPreviewRequest(input.totalValue, input.rows), key.current),
    onSuccess: (lines) => {
      setFormError(null);
      setPreview({ lines, source: 'CLIENT_SUPPLIED_UNVERIFIED', at: new Date().toISOString() });
      setPreviewedFor(current);
      key.current = newIdempotencyKey('rebalance');
    },
    onError: () => setFormError(t('rebalance.invalidRow')),
  });

  const valuationMutation = useMutation({
    mutationFn: () => copyTradingExtendedApi.getPortfolioValuation({ quoteAsset: quoteAsset.trim().toUpperCase() }),
    onSuccess: (value) => setValuation(value),
    onError: () => setValuation(null),
  });

  const draftProblem = useMemo(() => {
    if (!DECIMAL_STRING.test(totalValue.trim())) return 'total';
    for (const row of rows) {
      if (!row.traderId.trim() || !DECIMAL_STRING.test(row.currentValue.trim())) return 'row';
      const weight = Number(row.targetWeightBps.trim());
      if (!Number.isInteger(weight) || weight < 0 || weight > 10000) return 'row';
    }
    return null;
  }, [totalValue, rows]);

  const submit = (): void => {
    if (draftProblem) {
      setFormError(draftProblem === 'total' ? t('rebalance.invalidTotal') : t('rebalance.invalidRow'));
      return;
    }
    previewMutation.mutate({ totalValue: totalValue.trim(), rows });
  };

  const update = (index: number, patch: Partial<Draft>): void => {
    setRows((previous) => previous.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  };

  return (
    <section aria-labelledby="rebalance-heading" className="space-y-6">
      <header>
        <h2 id="rebalance-heading" className="text-lg font-semibold">{t('rebalance.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('rebalance.intro')}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">{t('rebalance.totalValue')}</span>
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            inputMode="decimal"
            value={totalValue}
            onChange={(event) => setTotalValue(event.target.value)}
            aria-describedby="rebalance-total-hint"
          />
          <span id="rebalance-total-hint" className="mt-1 block text-xs text-muted">{t('rebalance.clientSupplied')}</span>
        </label>
        <label className="block text-sm">
          <span className="font-medium">{t('rebalance.quoteAsset')}</span>
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={quoteAsset}
            onChange={(event) => setQuoteAsset(event.target.value)}
          />
        </label>
      </div>

      <button
        type="button"
        className="rounded border px-3 py-2 text-sm"
        onClick={() => valuationMutation.mutate()}
        disabled={valuationMutation.isPending || !/^[A-Za-z0-9]{2,16}$/.test(quoteAsset.trim())}
        aria-busy={valuationMutation.isPending}
      >
        {t('rebalance.preview')}
      </button>

      {/* A disabled button alone tells a screen reader nothing about work in flight: the same state is
          announced as text, and the poll of the persisted valuation is visible while it runs. */}
      {valuationMutation.isPending && <LoadingState message={t('common.loading')} />}

      {valuation && (
        <div className="rounded border p-3 text-sm" aria-live="polite">
          <p className="font-medium">{t('rebalance.result')}</p>
          {valuation.state === 'UNAVAILABLE' || valuation.quoteAssets.length === 0 ? (
            <p className="mt-1 text-muted">{t('accounting.notAvailable')}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {valuation.quoteAssets.map((group) => (
                <li key={group.quoteAsset}>
                  {group.quoteAsset}: {group.totalValue ?? t('common.unavailable')} ({group.state})
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-muted">{valuation.provenance} · {t('rebalance.confirm')}</p>
        </div>
      )}

      <table className="w-full text-sm">
        <caption className="sr-only">{t('rebalance.allocations')}</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left">{t('rebalance.trader')}</th>
            <th scope="col" className="text-left">{t('rebalance.currentValue')}</th>
            <th scope="col" className="text-left">{t('rebalance.targetWeightBps')}</th>
            <th scope="col" className="text-left">{t('rebalance.priceAvailable')}</th>
            <th scope="col" className="text-left">{t('common.action')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td>
                <input
                  aria-label={`${t('rebalance.trader')} ${index + 1}`}
                  className="w-full rounded border px-2 py-1"
                  value={row.traderId}
                  onChange={(event) => update(index, { traderId: event.target.value })}
                />
              </td>
              <td>
                <input
                  aria-label={`${t('rebalance.currentValue')} ${index + 1}`}
                  inputMode="decimal"
                  className="w-full rounded border px-2 py-1"
                  value={row.currentValue}
                  onChange={(event) => update(index, { currentValue: event.target.value })}
                />
              </td>
              <td>
                <input
                  aria-label={`${t('rebalance.targetWeightBps')} ${index + 1}`}
                  inputMode="numeric"
                  className="w-full rounded border px-2 py-1"
                  value={row.targetWeightBps}
                  onChange={(event) => update(index, { targetWeightBps: event.target.value })}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`${t('rebalance.priceAvailable')} ${index + 1}`}
                  checked={row.priceAvailable}
                  onChange={(event) => update(index, { priceAvailable: event.target.checked })}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => setRows((previous) => (previous.length === 1 ? previous : previous.filter((_, position) => position !== index)))}
                >
                  {t('rebalance.removeRow')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => setRows((previous) => [...previous, { ...EMPTY_DRAFT }])}>
          {t('rebalance.addRow')}
        </button>
        <button type="button" className="rounded bg-primary px-3 py-2 text-sm text-white" onClick={submit} disabled={previewMutation.isPending} aria-busy={previewMutation.isPending}>
          {t('rebalance.preview')}
        </button>
      </div>

      {previewMutation.isPending && <LoadingState message={t('common.loading')} />}

      <p role="status" aria-live="polite" className="min-h-[1.25rem] text-sm text-danger">{formError ?? ''}</p>
      {previewMutation.isError && <ErrorState error={previewMutation.error} />}

      {stale && (
        <p role="alert" className="rounded border border-warning p-3 text-sm">{t('rebalance.stale')}</p>
      )}

      {preview === null ? (
        <EmptyState title={t('rebalance.empty')} description={t('rebalance.previewNote')} />
      ) : (
        <div aria-live="polite" className="space-y-2">
          <h3 className="text-md font-semibold">{t('rebalance.result')}</h3>
          <p className="text-xs text-muted">{t('rebalance.accepted')} ({preview.source}, {preview.at})</p>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className="text-left">{t('rebalance.trader')}</th>
                <th scope="col" className="text-left">{t('rebalance.currentValue')}</th>
                <th scope="col" className="text-left">{t('rebalance.targetValue')}</th>
                <th scope="col" className="text-left">{t('rebalance.deltaValue')}</th>
                <th scope="col" className="text-left">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((line) => (
                <tr key={line.traderId}>
                  <td>{line.traderId}</td>
                  <td>{line.currentValue}</td>
                  <td>{line.targetValue ?? t('common.unavailable')}</td>
                  <td>{line.deltaValue ?? t('common.unavailable')}</td>
                  <td>{line.status === 'PREVIEW' ? t('rebalance.statusPreview') : t('common.unavailable')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rounded border p-3 text-sm">{t('rebalance.confirm')} {t('rebalance.confirmNote')}</p>
        </div>
      )}
    </section>
  );
}
